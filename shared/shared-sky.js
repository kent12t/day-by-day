// The opt-in, anonymous "shared sky" client (issue #3, phase 2).
//
// OFF by default. While it is off, or when no Convex URL was configured at build time, this module makes ZERO
// network requests and never even loads the Convex client (it is `import()`ed lazily, only after the person turns
// sharing on). Everything is fail-soft: offline or any error just means the shared layer stays hidden.
//
// What can leave the device: { deviceId, topic, depth, day, seed } per star. See shared/star-rules.js.
import { hashString, localDayKey } from "../lib/prompt-logic.js";
import { dayDifference, isDepth, isTopic, isValidDayKey, MAX_DAY_DRIFT, SEED_MAX } from "./star-rules.js";

export const CONVEX_URL = (import.meta.env && import.meta.env.VITE_CONVEX_URL) || "";

const KEYS = {
  device: "dayByDay.shared.device.v1",
  enabled: "dayByDay.shared.enabled.v1",
  queue: "dayByDay.shared.queue.v1",
  published: "dayByDay.shared.published.v1",
  showSky: "dayByDay.shared.showSky.v1",
};
const PUBLISHED_KEEP_DAYS = 7;
const MAX_QUEUE = 50;

// Production client loader. The dynamic import keeps `convex` out of the main bundle and off the network until
// sharing is switched on.
export async function loadConvexClient(url) {
  // Build-time constant: without VITE_CONVEX_URL this branch (and the whole Convex client chunk) is dropped from
  // the build, so a default build neither ships nor precaches any backend code.
  if (import.meta.env && import.meta.env.VITE_CONVEX_URL) {
    const [{ ConvexClient }, { anyApi }] = await Promise.all([import("convex/browser"), import("convex/server")]);
    return { client: new ConvexClient(url), api: anyApi };
  }
  throw new Error("The shared sky is not configured.");
}

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch (err) {
    return null;
  }
}
function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}
function safeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch (err) {
    /* storage unavailable */
  }
}
function readJson(storage, key, fallback) {
  const raw = safeGet(storage, key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
}

function randomUuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  // very old browsers: build a v4-shaped id from getRandomValues
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomSeed() {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0] % (SEED_MAX + 1);
}

// A stable, non-reversible local key for "this entry was already published". The entry id itself is never stored
// in the published set and never sent anywhere.
export function publishedKey(deviceId, entryId) {
  return (hashString(`${deviceId}:${entryId}`) >>> 0).toString(36);
}

const starIdentity = (star) => `${star.topic}:${star.depth}:${star.seed}`;

/* createSharedSky({ url, storage, loadClient, now, random, uuid, win })
 * Everything environmental is injectable so the queue / idempotency logic is unit-testable with a fake client. */
export function createSharedSky(options = {}) {
  const url = options.url === undefined ? CONVEX_URL : options.url;
  const storage = options.storage || globalThis.localStorage;
  const loadClient = options.loadClient || loadConvexClient;
  const now = options.now || (() => new Date());
  const newSeed = options.random || randomSeed;
  const newUuid = options.uuid || randomUuid;
  const win = options.win === undefined ? globalThis.window : options.win;

  const listeners = new Set();
  const snapshot = { status: "off", count: 0, stars: [] }; // status: off | connecting | live | offline
  let connection = null; // { client, api, unsubscribers: [] }
  let connecting = null;
  let subscribedDay = "";
  let flushing = false;
  let todayStars = [];
  let todayCount = 0;
  let dayTimer = 0;

  const available = () => Boolean(url);
  const enabled = () => available() && safeGet(storage, KEYS.enabled) === "1";

  function deviceId({ create }) {
    let id = safeGet(storage, KEYS.device);
    if (!id && create) {
      id = newUuid();
      safeSet(storage, KEYS.device, id);
    }
    return id;
  }

  const readQueue = () => {
    const queue = readJson(storage, KEYS.queue, []);
    return Array.isArray(queue) ? queue : [];
  };
  const writeQueue = (queue) => safeSet(storage, KEYS.queue, JSON.stringify(queue.slice(-MAX_QUEUE)));
  const readPublished = () => readJson(storage, KEYS.published, {});
  const writePublished = (map) => safeSet(storage, KEYS.published, JSON.stringify(map));

  // Stars this device published today: used to turn "412 reflected" into "411 others" and to hide your own stars
  // from the distant field (yours are drawn by the atlas itself).
  function ownToday(day) {
    return Object.values(readPublished()).filter((record) => record && record.day === day);
  }

  function emit() {
    const day = localDayKey(now());
    const own = ownToday(day);
    const ownIds = new Set(own.map(starIdentity));
    const others = todayStars.filter((star) => !ownIds.has(starIdentity(star)));
    snapshot.stars = others;
    snapshot.count = Math.max(0, todayCount - own.length);
    for (const listener of listeners) {
      try {
        listener({ ...snapshot });
      } catch (err) {
        console.error("shared sky listener failed:", err);
      }
    }
  }

  function setStatus(status) {
    snapshot.status = status;
    emit();
  }

  async function connect() {
    if (connection) return connection;
    if (!available()) return null;
    if (!connecting) {
      connecting = (async () => {
        try {
          const loaded = await loadClient(url);
          connection = { client: loaded.client, api: loaded.api, unsubscribers: [] };
          return connection;
        } catch (err) {
          console.warn("Shared sky unavailable:", err);
          return null;
        } finally {
          connecting = null;
        }
      })();
    }
    return connecting;
  }

  function unsubscribeAll() {
    if (!connection) return;
    for (const stop of connection.unsubscribers) {
      try {
        stop();
      } catch (err) {
        /* already closed */
      }
    }
    connection.unsubscribers = [];
    subscribedDay = "";
  }

  function disconnect() {
    unsubscribeAll();
    if (connection) {
      try {
        connection.client.close();
      } catch (err) {
        /* already closed */
      }
    }
    connection = null;
    todayStars = [];
    todayCount = 0;
    clearInterval(dayTimer);
    dayTimer = 0;
  }

  async function subscribeToday() {
    const conn = connection;
    if (!conn || !enabled()) return;
    const day = localDayKey(now());
    if (day === subscribedDay) return;
    unsubscribeAll();
    subscribedDay = day;
    todayStars = [];
    todayCount = 0;
    const onError = () => setStatus("offline");
    conn.unsubscribers.push(
      conn.client.onUpdate(
        conn.api.stars.today,
        { day },
        (stars) => {
          todayStars = (Array.isArray(stars) ? stars : []).filter(
            (s) => s && isTopic(s.topic) && isDepth(s.depth) && Number.isInteger(s.seed)
          );
          snapshot.status = "live";
          emit();
        },
        onError
      ),
      conn.client.onUpdate(
        conn.api.stars.countToday,
        { day },
        (count) => {
          todayCount = Number.isFinite(count) ? count : 0;
          snapshot.status = "live";
          emit();
        },
        onError
      )
    );
  }

  // Publishes whatever is queued. Network failures keep the star queued for the next try; a rejection from the
  // server (rate limit, day out of range, ...) drops it, since retrying cannot help.
  async function flush() {
    if (flushing || !enabled()) return;
    const queue = readQueue();
    if (!queue.length) return;
    flushing = true;
    try {
      const conn = await connect();
      if (!conn) return;
      let remaining = readQueue();
      for (const item of [...remaining]) {
        const payload = {
          deviceId: item.deviceId,
          topic: item.topic,
          depth: item.depth,
          day: item.day,
          seed: item.seed,
        };
        try {
          await conn.client.mutation(conn.api.stars.publish, payload);
        } catch (err) {
          const rejected = err && err.data && typeof err.data === "object" && err.data.code;
          if (!rejected) {
            setStatus("offline");
            return; // offline or transient: keep it and everything behind it queued
          }
        }
        remaining = remaining.filter((q) => q.key !== item.key);
        writeQueue(remaining);
        const published = readPublished();
        published[item.key] = { day: item.day, topic: item.topic, depth: item.depth, seed: item.seed };
        writePublished(published);
      }
      emit();
    } finally {
      flushing = false;
    }
  }

  function prunePublished() {
    const today = localDayKey(now());
    const published = readPublished();
    let changed = false;
    for (const [key, record] of Object.entries(published)) {
      if (!record || !isValidDayKey(record.day) || dayDifference(record.day, today) > PUBLISHED_KEEP_DAYS) {
        delete published[key];
        changed = true;
      }
    }
    if (changed) writePublished(published);
  }

  async function start() {
    if (!enabled()) return;
    setStatus("connecting");
    const conn = await connect();
    if (!conn) return setStatus("offline");
    prunePublished();
    await subscribeToday();
    await flush();
    if (!dayTimer && win) dayTimer = setInterval(refreshDay, 5 * 60 * 1000);
  }

  async function refreshDay() {
    if (!enabled() || !connection) return;
    await subscribeToday();
    await flush();
  }

  const api = {
    isAvailable: available,
    isEnabled: enabled,
    getSnapshot: () => ({ ...snapshot }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isSkyVisible: () => safeGet(storage, KEYS.showSky) !== "0",
    setSkyVisible(visible) {
      safeSet(storage, KEYS.showSky, visible ? "1" : "0");
    },

    // Called once at start-up: reconnects only if the person already turned sharing on.
    async init() {
      if (!enabled()) return;
      if (win) {
        win.addEventListener("online", () => flush());
        win.document?.addEventListener("visibilitychange", () => {
          if (win.document.visibilityState === "visible") refreshDay();
        });
      }
      await start();
    },

    async setEnabled(on) {
      if (!available()) return false;
      if (on) {
        deviceId({ create: true });
        safeSet(storage, KEYS.enabled, "1");
        await start();
        return true;
      }
      safeSet(storage, KEYS.enabled, "0");
      safeRemove(storage, KEYS.queue); // nothing waits to be sent once sharing is off
      disconnect();
      setStatus("off");
      return true;
    },

    // Queue (and try to publish) the star for a freshly saved entry. Only the entry's topic, depth and local day
    // are used; the entry id only feeds a one-way hash that stays on this device.
    async publishEntry(entry) {
      if (!enabled() || !entry || !isTopic(entry.topic) || !isDepth(entry.depth)) return false;
      const id = deviceId({ create: true });
      const day = localDayKey(entry.date || now());
      const today = localDayKey(now());
      if (!isValidDayKey(day) || Math.abs(dayDifference(today, day)) > MAX_DAY_DRIFT) return false;
      const key = publishedKey(id, String(entry.id));
      const queue = readQueue();
      if (readPublished()[key] || queue.some((q) => q.key === key)) return false; // idempotent
      queue.push({ key, deviceId: id, topic: entry.topic, depth: entry.depth, day, seed: newSeed() });
      writeQueue(queue);
      await flush();
      return true;
    },

    flush,
    refreshDay,

    // "Stop sharing & remove my stars". Resolves { ok, removed }. Needs the network; when it fails nothing local
    // changes, so it can simply be tried again.
    async withdraw() {
      const id = deviceId({ create: false });
      if (!id) {
        await api.setEnabled(false);
        return { ok: true, removed: 0 };
      }
      const conn = await connect();
      if (!conn) return { ok: false, removed: 0 };
      try {
        const result = await conn.client.mutation(conn.api.stars.withdraw, { deviceId: id });
        safeSet(storage, KEYS.enabled, "0");
        safeRemove(storage, KEYS.queue);
        safeRemove(storage, KEYS.published);
        safeRemove(storage, KEYS.device); // a fresh anonymous identity next time
        disconnect();
        setStatus("off");
        return { ok: true, removed: (result && result.removed) || 0 };
      } catch (err) {
        if (!enabled()) disconnect(); // do not leave a socket open just for a failed removal
        return { ok: false, removed: 0 };
      }
    },
  };
  return api;
}
