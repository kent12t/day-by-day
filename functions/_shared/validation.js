const TOPICS = new Set([
  "self",
  "relationships",
  "work",
  "body",
  "gratitude",
  "dreams",
  "creativity",
  "nature",
  "spirit",
  "legacy",
  "wildcard",
]);

const DEPTHS = new Set(["gentle", "deeper", "bold", "ethereal"]);
const MODES = new Set(["offline", "text", "photo"]);

export function validateEntryShape(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = asTrimmedString(raw.id);
  const date = asIsoDate(raw.date);
  const topic = TOPICS.has(raw.topic) ? raw.topic : "self";
  const topicPicker = TOPICS.has(raw.topicPicker) ? raw.topicPicker : topic;
  const depth = DEPTHS.has(raw.depth) ? raw.depth : "gentle";
  const promptId = asTrimmedString(raw.promptId);
  const promptText = asTrimmedString(raw.promptText);
  const followUp = typeof raw.followUp === "string" ? raw.followUp : "";
  const mode = MODES.has(raw.mode) ? raw.mode : "offline";
  const text = typeof raw.text === "string" ? raw.text : "";
  const updatedAt = asIsoDate(raw.updatedAt) || date;
  const hasPhoto = Boolean(raw.hasPhoto) && mode === "photo";
  const photoKey = typeof raw.photoKey === "string" && raw.photoKey.trim() ? raw.photoKey.trim() : null;

  if (!id || !date || !promptId || !promptText) return null;
  if (id.length > 180) return null;
  if (promptId.length > 180) return null;
  if (promptText.length > 1200) return null;
  if (followUp.length > 2000) return null;
  if (text.length > 20000) return null;
  if (photoKey && photoKey.length > 600) return null;

  return {
    id,
    date,
    topic,
    topicPicker,
    depth,
    promptId,
    promptText,
    followUp,
    mode,
    text,
    hasPhoto,
    photoKey,
    updatedAt,
  };
}

export function validateDeletes(rawDeletes) {
  if (!Array.isArray(rawDeletes)) return [];
  return rawDeletes
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = asTrimmedString(item.id);
      const deletedAt = asIsoDate(item.deletedAt);
      if (!id || !deletedAt) return null;
      return { id, deletedAt };
    })
    .filter(Boolean);
}

export function parseDataUrlImage(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return null;
  }

  const estimatedBytes = Math.ceil((match[2].length * 3) / 4);
  if (estimatedBytes > 6 * 1024 * 1024) {
    return null;
  }

  let bytes = null;
  try {
    const binary = atob(match[2]);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {
    return null;
  }

  if (bytes.byteLength > 6 * 1024 * 1024) {
    return null;
  }

  return { bytes, mimeType };
}

function asTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asIsoDate(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  if (Number.isNaN(Date.parse(value))) return "";
  return value;
}
