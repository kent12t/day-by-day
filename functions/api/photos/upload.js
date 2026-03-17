import { requireUser } from "../../_shared/auth.js";
import { error, json, parseJson } from "../../_shared/json.js";
import { parseDataUrlImage } from "../../_shared/validation.js";

export async function onRequestPost(context) {
  if (!context.env.PHOTOS) {
    return error("SERVER_ERROR", "Photo storage is not configured.", 500);
  }

  const auth = await requireUser(context);
  if (!auth.ok) return auth.response;

  const body = await parseJson(context.request);
  const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
  const parsedImage = parseDataUrlImage(body?.photoDataUrl);

  if (!entryId || !parsedImage) {
    return error("INVALID_INPUT", "entryId and a valid photoDataUrl are required.", 400);
  }

  try {
    const photoKey = `photos/${auth.userId}/${entryId}`;
    await context.env.PHOTOS.put(photoKey, parsedImage.bytes, {
      httpMetadata: { contentType: parsedImage.mimeType },
    });

    return json({ ok: true, photoKey });
  } catch {
    return error("SERVER_ERROR", "Could not upload photo.", 500);
  }
}
