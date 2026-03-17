import { randomToken } from "./auth.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const OAUTH_STATE_COOKIE = "dayByDayOauthState";

export async function createGoogleAuthRequest(context) {
  const clientId = requiredEnv(context.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  const stateTtlSeconds = Number(context.env.OAUTH_STATE_TTL_SECONDS || 600);
  const issuedAt = Date.now();
  const nonce = randomToken("st_");
  const statePayload = `${nonce}.${issuedAt}`;
  const signature = await signState(context, statePayload);
  const cookieValue = `${statePayload}.${signature}`;

  const callbackUrl = getGoogleRedirectUri(context);
  const scope =
    typeof context.env.OAUTH_GOOGLE_SCOPES === "string" ? context.env.OAUTH_GOOGLE_SCOPES : "openid email profile";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope,
    state: statePayload,
    prompt: "select_account",
  });

  const cookie = buildCookie(context, OAUTH_STATE_COOKIE, cookieValue, stateTtlSeconds);
  const redirect = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  return { redirect, cookie };
}

export async function verifyGoogleState(context, state) {
  const ttlSeconds = Number(context.env.OAUTH_STATE_TTL_SECONDS || 600);
  const cookieValue = readCookie(context.request.headers.get("cookie"), OAUTH_STATE_COOKIE);
  if (!state || !cookieValue) return false;

  const stateParts = state.split(".");
  const cookieParts = cookieValue.split(".");
  if (stateParts.length !== 2 || cookieParts.length !== 3) return false;

  const cookiePayload = `${cookieParts[0]}.${cookieParts[1]}`;
  if (cookiePayload !== state) return false;

  const issuedAt = Number(stateParts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > ttlSeconds * 1000) return false;

  const expectedSig = await signState(context, state);
  return safeEqual(expectedSig, cookieParts[2]);
}

export function buildClearedOauthStateCookie(context) {
  return buildCookie(context, OAUTH_STATE_COOKIE, "", 0);
}

export async function exchangeGoogleCode(context, code) {
  const clientId = requiredEnv(context.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv(context.env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
  const callbackUrl = getGoogleRedirectUri(context);

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("Google token exchange failed.");
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("Google token response missing access token.");
  }

  return {
    accessToken: payload.access_token,
  };
}

export async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Could not load Google profile.");
  }

  const payload = await response.json();
  if (!payload?.sub || typeof payload.sub !== "string") {
    throw new Error("Google profile missing account id.");
  }

  return {
    providerSubject: payload.sub,
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : "",
    emailVerified: Boolean(payload.email_verified),
  };
}

function getGoogleRedirectUri(context) {
  const callbackPath =
    typeof context.env.OAUTH_GOOGLE_CALLBACK_PATH === "string"
      ? context.env.OAUTH_GOOGLE_CALLBACK_PATH
      : "/api/auth/google/callback";
  const baseUrl = getBaseUrl(context);
  return new URL(callbackPath, baseUrl).toString();
}

function getBaseUrl(context) {
  return new URL(context.request.url).origin;
}

async function signState(context, payload) {
  const secret = requiredEnv(context.env.OAUTH_STATE_SECRET || context.env.SESSION_HMAC_SECRET, "OAUTH_STATE_SECRET");
  const keyData = new TextEncoder().encode(secret);
  const message = new TextEncoder().encode(payload);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
  const bytes = Array.from(new Uint8Array(signature));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildCookie(context, name, value, maxAge) {
  const requestUrl = new URL(context.request.url);
  const isSecure = requestUrl.protocol === "https:" || context.env.APP_ENV === "production";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`(?:^|; )${escapedName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function requiredEnv(value, key) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}
