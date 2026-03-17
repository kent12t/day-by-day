import { createSession, randomToken, sha256 } from "../../_shared/auth.js";
import { error, json } from "../../_shared/json.js";

export async function onRequestPost(context) {
  if (!context.env.DB) {
    return error("SERVER_ERROR", "Storage is not configured.", 500);
  }

  try {
    const userId = randomToken("u_");
    const syncKey = randomToken("sync_");
    const syncKeyHash = await sha256(syncKey);
    const now = new Date().toISOString();

    await context.env.DB.prepare(
      "INSERT INTO users (id, sync_key_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)"
    )
      .bind(userId, syncKeyHash, now, now)
      .run();

    const session = await createSession(context, userId);
    const cursorRow = await context.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE user_id = ?")
      .bind(userId)
      .first();

    return json(
      {
        ok: true,
        userId,
        syncKey,
        cursor: Number(cursorRow?.cursor || 0),
      },
      {
        headers: {
          "Set-Cookie": session.cookie,
        },
      }
    );
  } catch {
    return error("SERVER_ERROR", "Could not create sync vault.", 500);
  }
}
