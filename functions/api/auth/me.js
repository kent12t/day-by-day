import { getSession } from "../../_shared/auth.js";
import { error, json } from "../../_shared/json.js";

export async function onRequestGet(context) {
  if (!context.env.DB) {
    return error("SERVER_ERROR", "Storage is not configured.", 500);
  }

  const session = await getSession(context);
  if (!session?.userId) {
    return json({
      ok: true,
      authenticated: false,
    });
  }

  try {
    const cursorRow = await context.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM change_log WHERE user_id = ?")
      .bind(session.userId)
      .first();

    let identity = null;
    try {
      identity = await context.env.DB.prepare(
        "SELECT provider, email FROM user_identities WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1"
      )
        .bind(session.userId)
        .first();
    } catch {
      identity = null;
    }

    return json({
      ok: true,
      authenticated: true,
      userId: session.userId,
      cursor: Number(cursorRow?.cursor || 0),
      provider: typeof identity?.provider === "string" ? identity.provider : "sync_key",
      email: maskEmail(identity?.email),
    });
  } catch {
    return error("SERVER_ERROR", "Could not load session details.", 500);
  }
}

function maskEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) return "";
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) return "";
  const safeLocal = localPart.length <= 2 ? `${localPart[0] || ""}*` : `${localPart.slice(0, 2)}***`;
  const domainParts = domain.split(".");
  const safeDomainRoot = domainParts[0] ? `${domainParts[0][0]}***` : "***";
  const suffix = domainParts.length > 1 ? `.${domainParts.slice(1).join(".")}` : "";
  return `${safeLocal}@${safeDomainRoot}${suffix}`;
}
