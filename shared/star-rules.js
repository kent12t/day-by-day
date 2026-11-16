// Pure rules for the opt-in "shared sky" (issue #3, phase 2).
//
// Imported by the Convex functions in convex/ AND by the browser client and Vitest tests, so it must stay plain
// JavaScript with no imports and no DOM / Convex dependencies. A shared star is deliberately tiny:
//   { deviceId, topic, depth, day, seed }
// and nothing else: no text, no photos, no prompt, no entry id, no exact time, no account.

export const TOPICS = [
  "self",
  "relationships",
  "work",
  "body",
  "gratitude",
  "dreams",
  "creativity",
  "nature",
  "spirit",
  "legacy",
];
export const DEPTHS = ["gentle", "deeper", "bold", "ethereal"];

// Where each topic's stars cluster, as fractions of the atlas world. app.js uses this same table for your own stars.
export const TOPIC_CENTERS = {
  self: [0.22, 0.42],
  relationships: [0.73, 0.37],
  work: [0.62, 0.22],
  body: [0.37, 0.61],
  gratitude: [0.49, 0.43],
  dreams: [0.79, 0.68],
  creativity: [0.15, 0.75],
  nature: [0.55, 0.85],
  spirit: [0.1, 0.2],
  legacy: [0.85, 0.15],
};

export const MAX_STARS_PER_DEVICE_PER_DAY = 10;
export const TODAY_LIMIT = 500; // most stars one "today" query returns
export const COUNT_LIMIT = 5000; // the count stops here ("5000+")
export const RETENTION_DAYS = 3; // stars older than this are deleted by the daily cron
export const MAX_DAY_DRIFT = 1; // a published day may differ from the server's UTC day by this many days
export const SEED_MAX = 2147483647; // 2^31 - 1

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isTopic(value) {
  return typeof value === "string" && TOPICS.includes(value);
}

export function isDepth(value) {
  return typeof value === "string" && DEPTHS.includes(value);
}

// "YYYY-MM-DD" that is a real calendar date (rejects 2026-02-31).
export function isValidDayKey(value) {
  if (typeof value !== "string") return false;
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isDeviceId(value) {
  return typeof value === "string" && DEVICE_ID_RE.test(value);
}

export function isSeed(value) {
  return Number.isInteger(value) && value >= 0 && value <= SEED_MAX;
}

function dayNumber(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

// Whole days from `a` to `b` (positive when b is later). Both must be valid day keys.
export function dayDifference(a, b) {
  return dayNumber(b) - dayNumber(a);
}

// The UTC day key for a Date (the server's clock; clients use localDayKey from lib/prompt-logic.js).
export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Days strictly before this key are expired.
export function retentionCutoffDay(serverDay, days = RETENTION_DAYS) {
  const date = new Date(dayNumber(serverDay) * 86400000);
  date.setUTCDate(date.getUTCDate() - days);
  return utcDayKey(date);
}

// Validates a publish request. Returns { ok: true } or { ok: false, code, message }.
// Any extra field is rejected so nothing personal can ride along.
export function validateStar(star, serverDay) {
  if (!star || typeof star !== "object") return { ok: false, code: "invalid", message: "Not a star." };
  const allowed = new Set(["deviceId", "topic", "depth", "day", "seed"]);
  for (const key of Object.keys(star)) {
    if (!allowed.has(key)) return { ok: false, code: "invalid", message: `Unexpected field: ${key}.` };
  }
  if (!isDeviceId(star.deviceId)) return { ok: false, code: "invalid_device", message: "Invalid device id." };
  if (!isTopic(star.topic)) return { ok: false, code: "invalid_topic", message: "Unknown topic." };
  if (!isDepth(star.depth)) return { ok: false, code: "invalid_depth", message: "Unknown depth." };
  if (!isValidDayKey(star.day)) return { ok: false, code: "invalid_day", message: "Invalid day." };
  if (!isSeed(star.seed)) return { ok: false, code: "invalid_seed", message: "Invalid seed." };
  if (isValidDayKey(serverDay) && Math.abs(dayDifference(serverDay, star.day)) > MAX_DAY_DRIFT) {
    return { ok: false, code: "day_out_of_range", message: "That day is too far from today." };
  }
  return { ok: true };
}

// `existingCount`: stars this device already has for the day.
export function isOverRateLimit(existingCount, limit = MAX_STARS_PER_DEVICE_PER_DAY) {
  return existingCount >= limit;
}

// The only fields ever sent back to other people. Never the device id, never the stored document id.
export function toPublicStar(doc) {
  return { topic: doc.topic, depth: doc.depth, seed: doc.seed };
}

// Same generator as app.js: small, fast, deterministic.
export function mulberry32(seed) {
  let state = seed | 0;
  return function random() {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function topicHash(topic) {
  let hash = 0;
  for (let i = 0; i < topic.length; i += 1) hash = (Math.imul(hash, 31) + topic.charCodeAt(i)) | 0;
  return hash;
}

// Deterministic world position + size for someone else's star, from its seed and topic: it clusters around the
// topic's centre like your own stars, but spreads wider so the shared stars read as a faint distant field.
export function sharedStarPlacement(star, world = { width: 1600, height: 900 }) {
  const rng = mulberry32((star.seed ^ topicHash(star.topic)) | 0);
  const center = TOPIC_CENTERS[star.topic] || [0.5, 0.45];
  const spreadX = world.width * 0.26;
  const spreadY = world.height * 0.3;
  const x = center[0] * world.width + (rng() + rng() - 1) * spreadX;
  const y = center[1] * world.height + (rng() + rng() - 1) * spreadY;
  const size = 0.9 + rng() * 1.1;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  return {
    x: clamp(x, 16, world.width - 16),
    y: clamp(y, 16, world.height - 16),
    size,
    phase: rng() * 6,
  };
}
