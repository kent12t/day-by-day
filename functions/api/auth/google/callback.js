import { buildClearedSessionCookie, createSession, destroySession, getSession, randomToken, sha256 } from "../../../_shared/auth.js";
import { buildClearedOauthStateCookie, exchangeGoogleCode, fetchGoogleProfile, verifyGoogleState } from "../../../_shared/oauth.js";

export async function onRequestGet(context) {
  if (!context.env.DB) {
    return new Response("Storage is not configured.", { status: 500 });
  }

  const requestUrl = new URL(context.request.url);
  const code = (requestUrl.searchParams.get("code") || "").trim();
  const state = (requestUrl.searchParams.get("state") || "").trim();
  const oauthError = (requestUrl.searchParams.get("error") || "").trim();

  if (oauthError) {
    return redirectToApp(context, "/?auth=google_denied", [buildClearedOauthStateCookie(context)]);
  }

  if (!code) {
    return redirectToApp(context, "/?auth=google_missing_code", [buildClearedOauthStateCookie(context)]);
  }

  const validState = await verifyGoogleState(context, state);
  if (!validState) {
    return redirectToApp(context, "/?auth=google_invalid_state", [buildClearedOauthStateCookie(context)]);
  }

  try {
    const token = await exchangeGoogleCode(context, code);
    const profile = await fetchGoogleProfile(token.accessToken);
    const now = new Date().toISOString();

    const identityRow = await context.env.DB.prepare(
      "SELECT user_id FROM user_identities WHERE provider = 'google' AND provider_subject = ?"
    )
      .bind(profile.providerSubject)
      .first();

    let userId = typeof identityRow?.user_id === "string" ? identityRow.user_id : "";
    if (!userId) {
      const currentSession = await getSession(context);
      userId = typeof currentSession?.userId === "string" ? currentSession.userId : "";
    }

    if (userId) {
      const linkedIdentity = await context.env.DB.prepare(
        "SELECT provider_subject FROM user_identities WHERE user_id = ? AND provider = 'google'"
      )
        .bind(userId)
        .first();
      if (
        linkedIdentity?.provider_subject &&
        typeof linkedIdentity.provider_subject === "string" &&
        linkedIdentity.provider_subject !== profile.providerSubject
      ) {
        return redirectToApp(context, "/?auth=google_conflict", [buildClearedOauthStateCookie(context)]);
      }
    }

    if (!userId) {
      userId = randomToken("u_");
      const syncKeyHash = await sha256(randomToken("sync_"));
      await context.env.DB.prepare(
        "INSERT INTO users (id, sync_key_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)"
      )
        .bind(userId, syncKeyHash, now, now)
        .run();
    } else {
      await context.env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, userId).run();
    }

    await context.env.DB.prepare(
      `INSERT INTO user_identities (
        id,
        user_id,
        provider,
        provider_subject,
        email,
        email_verified,
        created_at,
        updated_at
      ) VALUES (?, ?, 'google', ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET
        user_id = excluded.user_id,
        email = excluded.email,
        email_verified = excluded.email_verified,
        updated_at = excluded.updated_at`
    )
      .bind(
        randomToken("idn_"),
        userId,
        profile.providerSubject,
        profile.email || null,
        profile.emailVerified ? 1 : 0,
        now,
        now
      )
      .run();

    await destroySession(context);
    const session = await createSession(context, userId);

    return redirectToApp(context, "/?auth=connected", [
      buildClearedOauthStateCookie(context),
      buildClearedSessionCookie(context),
      session.cookie,
    ]);
  } catch (err) {
    console.error("Google OAuth callback failed.");
    return redirectToApp(context, "/?auth=google_failed", [buildClearedOauthStateCookie(context)]);
  }
}

function redirectToApp(context, path, cookies = []) {
  const baseUrl = new URL(context.request.url).origin;
  const location = new URL(path, baseUrl).toString();
  const headers = new Headers({ Location: location });
  cookies.forEach((cookie) => headers.append("Set-Cookie", cookie));
  return new Response(null, { status: 302, headers });
}
