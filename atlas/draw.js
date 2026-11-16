/* atlas/draw.js: underpainting helpers, in units (the canvas is 1000 wide).
 * Adapted from paint-generator/studio/draw.js (same author), trimmed to what the sky scene uses. */

export const ell = (c, x, y, rx, ry, fill, rot = 0) => { c.beginPath(); c.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); };
export const lin = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [t, col] of stops) g.addColorStop(t, col); return g; };
export const rad = (c, x, y, r0, r1, stops) => { const g = c.createRadialGradient(x, y, r0, x, y, r1); for (const [t, col] of stops) g.addColorStop(t, col); return g; };
export const withAlpha = (c, a, fn) => { const g = c.globalAlpha; c.globalAlpha = g * a; fn(); c.globalAlpha = g; };

export function rgb(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/* a soft round glow: a radial gradient from colour (alpha a) to clear, optionally squashed and rotated */
export function glow(c, x, y, r, col, a = 1, sx = 1, rot = 0) {
  if (r <= 0) return;
  c.save(); c.translate(x, y); if (rot) c.rotate(rot); if (sx !== 1) c.scale(sx, 1);
  c.fillStyle = rad(c, 0, 0, 0, r, [[0, rgba(col, a)], [1, rgba(col, 0)]]);
  c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}
