// Photo storage for Day by Day.
// Photo blobs live in IndexedDB keyed by entry id so the localStorage entry
// list only carries small metadata (see issue #7).

const DB_NAME = "dayByDay.photos";
const DB_VERSION = 1;
const STORE_NAME = "photos";

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;

let dbPromise = null;
let persistRequested = false;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error("Could not open photo database"));
    request.onblocked = () => reject(new Error("Photo database is blocked by another tab"));
  });

  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

async function runTransaction(mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    const request = operation(store);
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("Photo transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Photo transaction aborted"));
  });
}

export async function putPhoto(entryId, blob) {
  if (!entryId || !(blob instanceof Blob)) throw new Error("A photo blob and entry id are required");
  await runTransaction("readwrite", (store) =>
    store.put({ blob, type: blob.type, size: blob.size, updatedAt: new Date().toISOString() }, entryId)
  );
  return entryId;
}

export async function getPhoto(entryId) {
  if (!entryId) return null;
  const record = await runTransaction("readonly", (store) => store.get(entryId));
  return record?.blob instanceof Blob ? record.blob : null;
}

export async function deletePhoto(entryId) {
  if (!entryId) return;
  await runTransaction("readwrite", (store) => store.delete(entryId));
}

export async function requestPersistentStorage() {
  if (persistRequested) return false;
  persistRequested = true;
  try {
    if (!navigator.storage?.persist) return false;
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch (err) {
    console.warn("Persistent storage request failed:", err);
    return false;
  }
}

export function dataUrlToBlob(dataUrl) {
  if (!isInlinePhoto(dataUrl)) throw new Error("Not a data URL");
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Malformed data URL");
  const header = dataUrl.slice(5, commaIndex).split(";");
  const type = header[0] || "application/octet-stream";
  const isBase64 = header.includes("base64");
  const payload = dataUrl.slice(commaIndex + 1);

  if (!isBase64) {
    return new Blob([decodeURIComponent(payload)], { type });
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> decoder below.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

// Downscale to PHOTO_MAX_EDGE on the long edge and re-encode as WebP,
// falling back to JPEG where WebP encoding is unsupported.
export async function compressImage(file, { maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY } = {}) {
  const image = await decodeImage(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("Image has no dimensions");

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.fillStyle = "#0b1228";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  if (typeof image.close === "function") image.close();

  let blob = await canvasToBlob(canvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp") {
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }
  if (!blob) throw new Error("Could not encode image");

  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

export function isInlinePhoto(value) {
  return typeof value === "string" && value.startsWith("data:");
}

// Moves legacy inline data-URL photos into IndexedDB. Returns the ids whose
// photo was written and verified; callers only strip the inline data URL for
// those ids, so a failed write leaves the original data intact.
export async function migrateInlinePhotos(entries) {
  const migratedIds = [];

  for (const entry of entries) {
    if (!isInlinePhoto(entry.photoDataUrl)) continue;

    try {
      const blob = dataUrlToBlob(entry.photoDataUrl);
      await putPhoto(entry.id, blob);
      const stored = await getPhoto(entry.id);
      if (!stored || stored.size !== blob.size) throw new Error("Photo verification failed");
      migratedIds.push(entry.id);
    } catch (err) {
      console.error(`Photo migration failed for ${entry.id}:`, err);
    }
  }

  return migratedIds;
}
