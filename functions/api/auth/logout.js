import { buildClearedSessionCookie, destroySession } from "../../_shared/auth.js";
import { json } from "../../_shared/json.js";

export async function onRequestPost(context) {
  await destroySession(context);
  return json(
    {
      ok: true,
    },
    {
      headers: {
        "Set-Cookie": buildClearedSessionCookie(context),
      },
    }
  );
}
