import { createSession, sha256 } from "../../_shared/auth.js";
import { error, json, parseJson } from "../../_shared/json.js";

export async function onRequestPost(context) {
  if (!context.env.DB) {
    return error("SERVER_ERROR", "Storage is not configured.", 500);
  }

  const body = await parseJson(context.request);
  const syncKey = typeof body?.syncKey === "string" ? body.syncKey.trim() : "";
  if (!syncKey) {
    return error("INVALID_INPUT", "syncKey is required.", 400);
  }

  try {
    const syncKeyHash = await sha256(syncKey);
    const user = await context.env.DB.prepare("SELECT id FROM users WHERE sync_key_hash = ?")
      .bind(syncKeyHash)
      .first();

    if (!user?.id) {
      return error("UNAUTHORIZED", "Invalid sync key.", 401);
    }

    const now = new Date().toISOString();
    await context.env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, user.id).run();

    const session = await createSession(context, user.id);
    const cursorRow = await context.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE user_id = ?")
      .bind(user.id)
      .first();

    return json(
      {
        ok: true,
        userId: user.id,
        cursor: Number(cursorRow?.cursor || 0),
      },
      {
        headers: {
          "Set-Cookie": session.cookie,
        },
      }
    );
  } catch {
    return error("SERVER_ERROR", "Could not create session.", 500);
  }
}
