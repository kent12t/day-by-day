/* atlas/sky-painter.js: gets a painted sky for a set of atlas nodes, as fast as it can.
 *
 *   memory cache  ->  IndexedDB cache (survives reloads)  ->  Web Worker (OffscreenCanvas)  ->  main thread
 *
 * The cache key is a hash of everything the painting depends on: each node's id, topic, depth and position (in
 * order), the world size, the paint width and PAINT_VERSION. Bump PAINT_VERSION whenever the scene or the brush
 * changes, so stale paintings are never shown. Everything here is fail-soft: if IndexedDB, the worker or
 * OffscreenCanvas are missing, it falls back and the atlas keeps working with its plain gradient. */
import { paintScene } from "./brush.js";
import { makeSkyScene } from "./sky-scene.js";

export const PAINT_VERSION = 2;
const PAINT_SEED = 7;
const COLOUR_VARIANCE = 0.15;
const IDB_NAME = "dayByDay.atlas";
const IDB_STORE = "paintings";
const IDB_RECORD = "sky";
const MEMORY_LIMIT = 3;

const memory = new Map(); // key -> ImageBitmap | canvas

export function paintKey(nodes, world, width) {
  let h = 0x811c9dc5;
  const feed = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
  feed(`v${PAINT_VERSION}|${world.width}x${world.height}|w${width}|`);
  for (const n of nodes) feed(`${n.id}:${n.topic}:${n.depth}:${n.x.toFixed(1)},${n.y.toFixed(1)},${n.size.toFixed(2)};`);
  return `sky-${PAINT_VERSION}-${nodes.length}-${(h >>> 0).toString(36)}`;
}

function remember(key, image) {
  memory.delete(key);
  memory.set(key, image);
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    const img = memory.get(oldest);
    memory.delete(oldest);
    if (img && typeof img.close === "function") img.close();
  }
}

/* ---------- IndexedDB: one record, the latest painting ---------- */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCachedBlob(key) {
  try {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_RECORD);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record && record.key === key && record.blob ? record.blob : null;
  } catch (err) {
    console.warn("Sky atlas: painting cache unavailable", err);
    return null;
  }
}

async function writeCachedBlob(key, blob) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ key, blob, savedAt: Date.now() }, IDB_RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn("Sky atlas: could not cache the painting", err);
  }
}

async function blobToImage(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- painters ---------- */
let worker = null;
let workerBroken = false;
let jobId = 0;
let pendingReject = null; // rejects the worker job in flight, if any

function getWorker() {
  if (workerBroken || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./paint-worker.js", import.meta.url), { type: "module" });
    return worker;
  } catch (err) {
    console.warn("Sky atlas: worker unavailable, painting on the main thread", err);
    workerBroken = true;
    return null;
  }
}

function stopWorker() {
  if (worker) worker.terminate();
  worker = null;
  if (pendingReject) pendingReject(new Error("superseded"));
  pendingReject = null;
}

function paintInWorker(w, job, onUnder) {
  return new Promise((resolve, reject) => {
    pendingReject = reject;
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.id !== job.id) return;
      if (msg.type === "under") { if (onUnder) onUnder(msg.bitmap); return; }
      if (msg.type === "done") { pendingReject = null; resolve({ image: msg.bitmap, ms: msg.ms, strokes: msg.strokes, from: "worker" }); return; }
      if (msg.type === "blob") { w.removeEventListener("message", onMessage); writeCachedBlob(job.key, msg.blob); return; }
      if (msg.type === "error") { w.removeEventListener("message", onMessage); reject(new Error(msg.message)); }
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", (event) => { event.preventDefault(); reject(new Error(event.message || "worker failed")); }, { once: true });
    w.postMessage({ id: job.id, nodes: job.nodes, world: job.world, width: job.width, seed: PAINT_SEED, colourVariance: COLOUR_VARIANCE });
  });
}

async function paintOnMainThread(job, isCurrent, onUnder) {
  const res = await paintScene(makeSkyScene(job.nodes, job.world), {
    seed: PAINT_SEED, width: job.width, colourVariance: COLOUR_VARIANCE, cooperative: true,
    onProgress: (f, label, under) => {
      if (!isCurrent()) throw new Error("superseded");
      if (label === "underpainting" && under && onUnder) onUnder(under);
    },
  });
  if (typeof res.canvas.convertToBlob === "function") {
    res.canvas.convertToBlob({ type: "image/webp", quality: 0.9 }).then((blob) => writeCachedBlob(job.key, blob)).catch(() => {});
  } else if (typeof res.canvas.toBlob === "function") {
    res.canvas.toBlob((blob) => { if (blob) writeCachedBlob(job.key, blob); }, "image/webp", 0.9);
  }
  return { image: res.canvas, ms: res.ms, strokes: res.strokes, from: "main" };
}

/* requestSkyPainting(nodes, { world, width, onUnder }) -> Promise<{ key, image, ms, from } | null>
 * nodes: [{ id, x, y, size, topic, depth }] in world units. Resolves null if a newer request replaced this one.
 * onUnder(image) is called with the soft underpainting when a fresh paint starts (not on cache hits). */
export async function requestSkyPainting(nodes, { world, width, onUnder } = {}) {
  const id = ++jobId;
  const isCurrent = () => id === jobId;
  if (pendingReject) stopWorker(); // the sky changed while a painting was under way: start over
  const plain = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, size: n.size, topic: n.topic, depth: n.depth }));
  const key = paintKey(plain, world, width);

  const hit = memory.get(key);
  if (hit) return { key, image: hit, ms: 0, from: "memory" };

  const blob = await readCachedBlob(key);
  if (!isCurrent()) return null;
  if (blob) {
    try {
      const image = await blobToImage(blob);
      remember(key, image);
      return isCurrent() ? { key, image, ms: 0, from: "indexeddb" } : null;
    } catch (err) {
      console.warn("Sky atlas: cached painting unreadable, repainting", err);
    }
  }

  const job = { id, key, nodes: plain, world, width };
  const under = (img) => { if (isCurrent() && onUnder) onUnder(img); };
  let result = null;
  const w = getWorker();
  if (w) {
    try {
      result = await paintInWorker(w, job, under);
    } catch (err) {
      if (!isCurrent()) return null;
      console.warn("Sky atlas: worker painting failed, painting on the main thread", err);
      workerBroken = true;
      stopWorker();
    }
  }
  if (!result) {
    try {
      result = await paintOnMainThread(job, isCurrent, under);
    } catch (err) {
      if (!isCurrent()) return null;
      console.error("Sky atlas: painting failed", err);
      return null;
    }
  }
  remember(key, result.image);
  return isCurrent() ? { key, ...result } : null;
}

/* a newer painting is wanted: stop a worker that is still busy with the old one */
export function cancelSkyPainting() {
  jobId += 1;
  stopWorker();
}
