import { error } from "./json.js";

const SESSION_COOKIE = "dayByDaySession";

export async function createSession(context, userId) {
  if (!context.env.SESSIONS) {
    throw new Error("SESSIONS binding is required");
  }

  const sessionToken = randomToken();
  const ttlSeconds = Number(context.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 30);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  await context.env.SESSIONS.put(sessionToken, JSON.stringify({ userId, expiresAt }), {
    expirationTtl: ttlSeconds,
  });

  const cookie = `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSeconds}`;

  return { cookie, expiresAt };
}

export async function requireUser(context) {
  const token = getSessionToken(context.request);
  if (!token) return { ok: false, response: error("UNAUTHORIZED", "Sign in to sync.", 401) };
  if (!context.env.SESSIONS) return { ok: false, response: error("SERVER_ERROR", "Session store not configured.", 500) };

  const value = await context.env.SESSIONS.get(token);
  if (!value) return { ok: false, response: error("UNAUTHORIZED", "Session expired.", 401) };

  let parsed = null;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, response: error("UNAUTHORIZED", "Invalid session.", 401) };
  }

  if (!parsed?.userId) {
    return { ok: false, response: error("UNAUTHORIZED", "Invalid session.", 401) };
  }

  return { ok: true, userId: parsed.userId };
}

export function getSessionToken(request) {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE);
}

export function buildClearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix = "") {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${token}`;
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}
