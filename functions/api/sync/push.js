import { requireUser } from "../../_shared/auth.js";
import { error, json, parseJson } from "../../_shared/json.js";
import { validateDeletes, validateEntryShape } from "../../_shared/validation.js";

export async function onRequestPost(context) {
  if (!context.env.DB) {
    return error("SERVER_ERROR", "Storage is not configured.", 500);
  }

  const auth = await requireUser(context);
  if (!auth.ok) return auth.response;

  const body = await parseJson(context.request);
  const incomingEntries = Array.isArray(body?.entries) ? body.entries.slice(0, 500) : [];
  const incomingDeletes = validateDeletes(body?.deletes).slice(0, 500);

  const entries = incomingEntries.map(validateEntryShape).filter(Boolean);
  const now = new Date().toISOString();

  try {
    for (const entry of entries) {
      const upsertResult = await context.env.DB.prepare(
        `INSERT INTO entries (
          user_id,
          id,
          date,
          topic,
          topic_picker,
          depth,
          prompt_id,
          prompt_text,
          follow_up,
          mode,
          text,
          has_photo,
          photo_key,
          updated_at,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(user_id, id) DO UPDATE SET
          date = excluded.date,
          topic = excluded.topic,
          topic_picker = excluded.topic_picker,
          depth = excluded.depth,
          prompt_id = excluded.prompt_id,
          prompt_text = excluded.prompt_text,
          follow_up = excluded.follow_up,
          mode = excluded.mode,
          text = excluded.text,
          has_photo = excluded.has_photo,
          photo_key = COALESCE(excluded.photo_key, entries.photo_key),
          updated_at = excluded.updated_at,
          deleted_at = NULL
        WHERE excluded.updated_at >= entries.updated_at`
      )
        .bind(
          auth.userId,
          entry.id,
          entry.date,
          entry.topic,
          entry.topicPicker,
          entry.depth,
          entry.promptId,
          entry.promptText,
          entry.followUp,
          entry.mode,
          entry.text,
          entry.hasPhoto ? 1 : 0,
          entry.photoKey,
          entry.updatedAt
        )
        .run();

      if (Number(upsertResult?.meta?.changes || 0) > 0) {
        await context.env.DB.prepare(
          "INSERT INTO change_log (user_id, entry_id, op, changed_at) VALUES (?, ?, 'upsert', ?)"
        )
          .bind(auth.userId, entry.id, now)
          .run();
      }
    }

    for (const item of incomingDeletes) {
      const existing = await context.env.DB.prepare("SELECT photo_key FROM entries WHERE user_id = ? AND id = ?")
        .bind(auth.userId, item.id)
        .first();
      const photoKey = typeof existing?.photo_key === "string" ? existing.photo_key : "";
      if (photoKey && context.env.PHOTOS) {
        await context.env.PHOTOS.delete(photoKey);
      }

      const deleteResult = await context.env.DB.prepare(
        "UPDATE entries SET deleted_at = ?, updated_at = ?, has_photo = 0, photo_key = NULL WHERE user_id = ? AND id = ?"
      )
        .bind(item.deletedAt, item.deletedAt, auth.userId, item.id)
        .run();

      if (Number(deleteResult?.meta?.changes || 0) > 0) {
        await context.env.DB.prepare(
          "INSERT INTO change_log (user_id, entry_id, op, changed_at) VALUES (?, ?, 'delete', ?)"
        )
          .bind(auth.userId, item.id, now)
          .run();
      }
    }

    const cursorRow = await context.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE user_id = ?")
      .bind(auth.userId)
      .first();

    return json({
      ok: true,
      cursor: Number(cursorRow?.cursor || 0),
      applied: {
        upserts: entries.length,
        deletes: incomingDeletes.length,
      },
    });
  } catch {
    return error("SERVER_ERROR", "Could not store entries.", 500);
  }
}
