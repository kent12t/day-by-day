/* atlas/poster.js: a high-resolution PNG poster of the Sky Atlas (issue #11), made entirely in the browser.
 *
 * It composes three things: the painted sky from sky-painter.js (the same cached painting the atlas shows, taken
 * from its memory/IndexedDB cache, or awaited if still being painted; the atlas's own gradient if it never
 * arrives), a canvas-drawn star layer in the spirit of atlas-view.js, and the title and count in the display
 * font. No atlas module is changed: this only reads their exports. */
import { paintKey, requestSkyPainting } from "./sky-painter.js";
import { MOONLIT } from "./sky-scene.js";

const POSTER_SCALE = 2; // 1600x900 world -> 3200x1800 px
const PAINT_WAIT_MS = 25000;
const DISPLAY_FONT = '"Instrument Serif", "Cormorant Garamond", Georgia, serif';
const BODY_FONT = '"Cormorant Garamond", Georgia, serif';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Resolves the painting for these nodes, or null. `svg.dataset.paintKey` is set by createPaintedSky once the painting
 * for the current nodes is showing, so waiting on it never competes with (or cancels) the atlas's own paint job. */
export async function resolveSkyPainting({ svg, nodes, world, paintWidth, timeoutMs = PAINT_WAIT_MS }) {
  const plain = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, size: n.size, topic: n.topic, depth: n.depth }));
  const key = paintKey(plain, world, paintWidth);
  const deadline = Date.now() + timeoutMs;
  while (svg.dataset.paintKey !== key) {
    if (Date.now() > deadline) return null;
    await sleep(150);
  }
  try {
    const result = await requestSkyPainting(plain, { world, width: paintWidth });
    return result ? result.image : null;
  } catch (err) {
    console.warn("Poster: could not read the painting", err);
    return null;
  }
}

function drawFallbackSky(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#080b1a");
  g.addColorStop(1, "#111734");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function rgbaOf(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* a tapered, slightly bowed ink stroke between two stars (same idea as the atlas's constellation strokes) */
function drawLink(ctx, link, i, k) {
  const a = link.from, b = link.to;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const ia = Math.min(len * 0.3, a.size * 1.6 + 3), ib = Math.min(len * 0.3, b.size * 1.6 + 3);
  const p0 = [a.x + ux * ia, a.y + uy * ia], p1 = [b.x - ux * ib, b.y - uy * ib];
  const bow = ((i * 7919) % 11 - 5) / 120;
  const mx = (p0[0] + p1[0]) / 2 + nx * bow * len, my = (p0[1] + p1[1]) / 2 + ny * bow * len;
  const w = (link.strength * 1.25) / 2;
  ctx.beginPath();
  ctx.moveTo(p0[0] * k, p0[1] * k);
  ctx.quadraticCurveTo((mx + nx * w * 2) * k, (my + ny * w * 2) * k, p1[0] * k, p1[1] * k);
  ctx.quadraticCurveTo((mx - nx * w * 2) * k, (my - ny * w * 2) * k, p0[0] * k, p0[1] * k);
  ctx.closePath();
  ctx.fillStyle = link.strength > 1 ? "rgba(240, 206, 140, 0.45)" : "rgba(226, 200, 160, 0.26)";
  ctx.fill();
}

function drawStar(ctx, node, k, mood) {
  const x = node.x * k, y = node.y * k, size = node.size * k;
  const hue = (MOONLIT[node.topic] || MOONLIT.wildcard)[0];
  const boost = mood ? 0.85 + mood * 0.06 : 1; // same subtle mood glow as the atlas overlay
  const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 1.9);
  halo.addColorStop(0, "rgba(255, 250, 240, 0.95)");
  halo.addColorStop(0.22, rgbaOf(hue, Math.min(1, 0.75 * boost)));
  halo.addColorStop(0.6, rgbaOf(hue, 0.16 * boost));
  halo.addColorStop(1, rgbaOf(hue, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, size * 1.9, 0, Math.PI * 2);
  ctx.fill();

  const s = size * 1.5, t = size * 0.16;
  ctx.beginPath();
  ctx.moveTo(x, y - s); ctx.lineTo(x + t, y - t); ctx.lineTo(x + s, y); ctx.lineTo(x + t, y + t);
  ctx.lineTo(x, y + s); ctx.lineTo(x - t, y + t); ctx.lineTo(x - s, y); ctx.lineTo(x - t, y - t);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 248, 232, 0.55)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, size * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = "#fffaf0";
  ctx.fill();
}

function drawTitle(ctx, w, h, { title, subtitle, dateLabel }) {
  const margin = w * 0.045;
  const fade = ctx.createLinearGradient(0, h * 0.72, 0, h);
  fade.addColorStop(0, "rgba(5, 7, 26, 0)");
  fade.addColorStop(1, "rgba(5, 7, 26, 0.78)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(255, 223, 162, 0.35)";
  ctx.shadowBlur = h * 0.02;
  ctx.fillStyle = "#f4eee2";
  ctx.font = `400 ${Math.round(h * 0.085)}px ${DISPLAY_FONT}`;
  ctx.fillText(title, margin, h - margin - h * 0.045);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#e9c98e";
  ctx.font = `600 ${Math.round(h * 0.03)}px ${BODY_FONT}`;
  ctx.fillText(subtitle, margin, h - margin + h * 0.012);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(244, 238, 226, 0.72)";
  ctx.fillText(dateLabel, w - margin, h - margin + h * 0.012);

  // a fine gold frame, like the atlas plate
  ctx.strokeStyle = "rgba(233, 201, 142, 0.5)";
  ctx.lineWidth = Math.max(2, h * 0.0016);
  const inset = h * 0.018;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
}

async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([document.fonts.load(`400 64px ${DISPLAY_FONT}`), document.fonts.load(`600 32px ${BODY_FONT}`)]);
  } catch (err) {
    console.warn("Poster: fonts unavailable, using fallbacks", err);
  }
}

/* renderAtlasPoster({ svg, nodes, links, world, paintWidth, moods, count, now })
 *   nodes: [{ id, x, y, size, topic, depth }] (the atlas nodes); links: [{ from, to, strength }];
 *   moods: optional { [entryId]: 1-5 } for the subtle glow. Returns { canvas, usedPainting }. */
export async function renderAtlasPoster({ svg, nodes, links = [], world, paintWidth, moods = {}, count = nodes.length, now = new Date() }) {
  const [image] = await Promise.all([resolveSkyPainting({ svg, nodes, world, paintWidth }), loadFonts()]);
  const k = POSTER_SCALE;
  const w = Math.round(world.width * k), h = Math.round(world.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  drawFallbackSky(ctx, w, h);
  if (image) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, w, h);
  }
  links.forEach((link, i) => drawLink(ctx, link, i, k));
  nodes.forEach((node) => drawStar(ctx, node, k, moods[node.id]));

  drawTitle(ctx, w, h, {
    title: "Day by Day",
    subtitle: count ? `${count} reflection${count === 1 ? "" : "s"}` : "A sky waiting for its first star",
    dateLabel: now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
  });
  return { canvas, usedPainting: Boolean(image) };
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
