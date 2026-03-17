import { error } from "./json.js";

const DEFAULT_SESSION_COOKIE = "__Host-dayByDaySession";

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

  const cookie = buildCookie(context, sessionCookieName(context), sessionToken, ttlSeconds);

  return { cookie, expiresAt };
}

export async function requireUser(context) {
  const token = getSessionToken(context);
  if (!token) return { ok: false, response: error("UNAUTHORIZED", "Sign in to sync.", 401) };
  if (!context.env.SESSIONS) return { ok: false, response: error("SERVER_ERROR", "Session store not configured.", 500) };

  const session = await getSession(context);
  if (!session?.userId) {
    return { ok: false, response: error("UNAUTHORIZED", "Invalid session.", 401) };
  }

  return { ok: true, userId: session.userId };
}

export async function getSession(context) {
  const token = getSessionToken(context);
  if (!token || !context.env.SESSIONS) return null;
  const value = await context.env.SESSIONS.get(token);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!parsed?.userId || typeof parsed.userId !== "string") return null;
    return {
      token,
      userId: parsed.userId,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : "",
    };
  } catch {
    return null;
  }
}

export function getSessionToken(context) {
  return readCookie(context.request.headers.get("cookie"), sessionCookieName(context));
}

export async function destroySession(context) {
  if (!context.env.SESSIONS) return;
  const token = getSessionToken(context);
  if (!token) return;
  await context.env.SESSIONS.delete(token);
}

export function buildClearedSessionCookie(context) {
  return buildCookie(context, sessionCookieName(context), "", 0);
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
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`(?:^|; )${escapedName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function sessionCookieName(context) {
  const name = typeof context.env.SESSION_COOKIE_NAME === "string" ? context.env.SESSION_COOKIE_NAME.trim() : "";
  return name || DEFAULT_SESSION_COOKIE;
}

function buildCookie(context, name, value, maxAge) {
  const requestUrl = new URL(context.request.url);
  const isSecure = requestUrl.protocol === "https:" || context.env.APP_ENV === "production";
  const configuredSameSite = normalizeSameSite(context.env.SESSION_COOKIE_SAMESITE);
  const sameSite = configuredSameSite === "None" && !isSecure ? "Lax" : configuredSameSite;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`,
  ];
  if (isSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function normalizeSameSite(rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (value === "strict") return "Strict";
  if (value === "none") return "None";
  return "Lax";
}
