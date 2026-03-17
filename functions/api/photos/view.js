import { requireUser } from "../../_shared/auth.js";
import { error } from "../../_shared/json.js";

export async function onRequestGet(context) {
  if (!context.env.PHOTOS || !context.env.DB) {
    return error("SERVER_ERROR", "Photo storage is not configured.", 500);
  }

  const auth = await requireUser(context);
  if (!auth.ok) return auth.response;

  const requestUrl = new URL(context.request.url);
  const entryId = (requestUrl.searchParams.get("entryId") || "").trim();
  if (!entryId) {
    return error("INVALID_INPUT", "entryId is required.", 400);
  }

  try {
    const entry = await context.env.DB.prepare(
      "SELECT has_photo, deleted_at FROM entries WHERE user_id = ? AND id = ?"
    )
      .bind(auth.userId, entryId)
      .first();

    if (!entry || entry.deleted_at || Number(entry.has_photo || 0) !== 1) {
      return new Response("", { status: 404 });
    }

    const key = `photos/${auth.userId}/${entryId}`;
    const object = await context.env.PHOTOS.get(key);
    if (!object) {
      return new Response("", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=300");
    return new Response(object.body, { headers });
  } catch {
    return error("SERVER_ERROR", "Could not read photo.", 500);
  }
}
