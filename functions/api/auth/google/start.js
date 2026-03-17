import { createGoogleAuthRequest } from "../../../_shared/oauth.js";

export async function onRequestGet(context) {
  try {
    const authRequest = await createGoogleAuthRequest(context);
    return new Response(null, {
      status: 302,
      headers: {
        Location: authRequest.redirect,
        "Set-Cookie": authRequest.cookie,
      },
    });
  } catch (err) {
    console.error("Google OAuth start failed.");
    return new Response("Google auth is not configured.", { status: 500 });
  }
}
