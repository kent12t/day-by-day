import { requireUser } from "../../_shared/auth.js";
import { error, json } from "../../_shared/json.js";

export async function onRequestGet(context) {
  if (!context.env.DB) {
    return error("SERVER_ERROR", "Storage is not configured.", 500);
  }

  const auth = await requireUser(context);
  if (!auth.ok) return auth.response;

  const requestUrl = new URL(context.request.url);
  const since = Number(requestUrl.searchParams.get("since") || 0);
  const safeSince = Number.isFinite(since) && since >= 0 ? since : 0;

  try {
    const changesResult = await context.env.DB.prepare(
      "SELECT seq, entry_id, op FROM change_log WHERE user_id = ? AND seq > ? ORDER BY seq ASC LIMIT 500"
    )
      .bind(auth.userId, safeSince)
      .all();

    const rows = Array.isArray(changesResult.results) ? changesResult.results : [];
    const output = [];

    for (const row of rows) {
      if (row.op === "delete") {
        output.push({ seq: row.seq, op: "delete", id: row.entry_id });
        continue;
      }

      const entry = await context.env.DB.prepare(
        `SELECT
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
          updated_at,
          deleted_at
        FROM entries
        WHERE user_id = ? AND id = ?`
      )
        .bind(auth.userId, row.entry_id)
        .first();

      if (!entry || entry.deleted_at) {
        output.push({ seq: row.seq, op: "delete", id: row.entry_id });
        continue;
      }

      output.push({
        seq: row.seq,
        op: "upsert",
        entry: {
          id: entry.id,
          date: entry.date,
          topic: entry.topic,
          topicPicker: entry.topic_picker,
          depth: entry.depth,
          promptId: entry.prompt_id,
          promptText: entry.prompt_text,
          followUp: entry.follow_up || "",
          mode: entry.mode,
          text: entry.text || "",
          hasPhoto: Boolean(entry.has_photo),
          updatedAt: entry.updated_at,
        },
      });
    }

    const cursor = rows.length ? Number(rows[rows.length - 1].seq || safeSince) : safeSince;
    return json({ ok: true, cursor, changes: output });
  } catch {
    return error("SERVER_ERROR", "Could not load sync changes.", 500);
  }
}
