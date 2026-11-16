/* atlas/brush.js: a painterly stroke renderer for the Sky Atlas.
 *
 * Adapted from paint-generator/studio/brush.js (same author), trimmed to what the atlas needs:
 * single light (no `times`), the `loaded` and `dab` hands plus hand-laid `line`/`dab` marks in after(), impasto
 * relief, and no deckle/paper frame (the painting fills the world edge to edge). Two changes for the browser app:
 *   - the per-pass blur is done in JS on ImageData instead of `ctx.filter = blur()`, so it runs the same in a Web
 *     Worker (OffscreenCanvas) and in browsers whose 2D canvas has no `filter` (Safari);
 *   - `o.cooperative` makes the painter yield to the event loop every ~12 ms, for the main-thread fallback.
 *
 * A scene draws a clean "underpainting" in units (1000 wide). The painter rebuilds it from thousands of
 * loaded-brush strokes, coarse to fine (after Hertzmann's layered curved strokes): each pass blurs the
 * underpainting to the brush's scale and lays a stroke wherever the canvas still differs from it; strokes follow
 * the image's edge tangents, or the scene's flow() in flat areas; colour is broken slightly toward the scene's
 * light colour in the lights and its shade colour in the darks; a height map is lit at the end for faint impasto.
 * Deterministic: all randomness comes from the seed (mulberry32). Never uses Math.random.
 *
 *   const { canvas, ms } = await paintScene(scene, { seed: 7, width: 1600 });
 */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const f = mulberry32(seed >>> 0);
  const r = (a = 0, b = 1) => a + (b - a) * f();
  return {
    r, f,
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    gauss: () => { let u = 0, v = 0; while (!u) u = f(); while (!v) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
    chance: (p) => f() < p,
  };
}

// OffscreenCanvas first (works in workers and on the main thread), a DOM canvas otherwise
export function canvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

export const hex = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/* ---------- gaussian-ish blur of an opaque RGBA buffer: three box passes each way ---------- */
function boxPass(src, dst, W, H, r, horizontal) {
  const n = horizontal ? W : H, lines = horizontal ? H : W, stride = horizontal ? 4 : W * 4, div = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * W * 4 : l * 4;
    let sr = 0, sg = 0, sb = 0;
    for (let i = -r; i <= r; i++) { const o = base + clamp(i, 0, n - 1) * stride; sr += src[o]; sg += src[o + 1]; sb += src[o + 2]; }
    for (let i = 0; i < n; i++) {
      const o = base + i * stride;
      dst[o] = sr / div; dst[o + 1] = sg / div; dst[o + 2] = sb / div; dst[o + 3] = 255;
      const a = base + Math.min(n - 1, i + r + 1) * stride, b = base + Math.max(0, i - r) * stride;
      sr += src[a] - src[b]; sg += src[a + 1] - src[b + 1]; sb += src[a + 2] - src[b + 2];
    }
  }
}
/* wide blurs run at half resolution (a quarter of the work) and are scaled back up; the result is used only for
 * stroke colour and placement, where the difference does not show */
function blurRGBFast(src, W, H, sigma, out, tmp, half) {
  if (sigma < 2.2) return blurRGB(src, W, H, sigma, out, tmp);
  const w2 = W >> 1, h2 = H >> 1;
  if (!half.src) { // 2x2 box downsample, once per painting
    half.src = new Uint8ClampedArray(w2 * h2 * 4); half.out = new Uint8ClampedArray(w2 * h2 * 4); half.tmp = new Uint8ClampedArray(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const o = (y * w2 + x) * 4, a = ((2 * y) * W + 2 * x) * 4, b = a + W * 4;
      for (let ch = 0; ch < 3; ch++) half.src[o + ch] = (src[a + ch] + src[a + 4 + ch] + src[b + ch] + src[b + 4 + ch]) >> 2;
      half.src[o + 3] = 255;
    }
  }
  blurRGB(half.src, w2, h2, sigma / 2, half.out, half.tmp);
  const hs = half.out;
  for (let y = 0; y < H; y++) { // bilinear back up to full size
    const fy = Math.min(h2 - 1.001, Math.max(0, y / 2 - 0.25)), y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w2 - 1.001, Math.max(0, x / 2 - 0.25)), x0 = fx | 0, tx = fx - x0;
      const p00 = (y0 * w2 + x0) * 4, p10 = p00 + 4, p01 = p00 + w2 * 4, p11 = p01 + 4, o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = hs[p00 + ch] + (hs[p10 + ch] - hs[p00 + ch]) * tx, bot = hs[p01 + ch] + (hs[p11 + ch] - hs[p01 + ch]) * tx;
        out[o + ch] = top + (bot - top) * ty;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
function blurRGB(src, W, H, sigma, out, tmp) {
  const r = Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2);
  if (r < 1) { out.set(src); return out; }
  boxPass(src, tmp, W, H, r, true); boxPass(tmp, out, W, H, r, false);
  boxPass(out, tmp, W, H, r, true); boxPass(tmp, out, W, H, r, false);
  boxPass(out, tmp, W, H, r, true); boxPass(tmp, out, W, H, r, false);
  return out;
}

/* ---------- orientation field from the underpainting (smoothed structure tensor) ---------- */
function orientationField(data, W, H, g, flow, k) {
  const gw = Math.ceil(W / g), gh = Math.ceil(H / g);
  const xx = new Float32Array(gw * gh), yy = new Float32Array(gw * gh), xy = new Float32Array(gw * gh);
  const L = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = Math.min(W - 1, i * g + (g >> 1)), y = Math.min(H - 1, j * g + (g >> 1)), o = (y * W + x) * 4;
    L[j * gw + i] = 0.3 * data[o] + 0.59 * data[o + 1] + 0.11 * data[o + 2];
  }
  const at = (i, j) => L[Math.min(gh - 1, Math.max(0, j)) * gw + Math.min(gw - 1, Math.max(0, i))];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const gx = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1)) - (at(i - 1, j - 1) + 2 * at(i - 1, j) + at(i - 1, j + 1));
    const gy = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1)) - (at(i - 1, j - 1) + 2 * at(i, j - 1) + at(i + 1, j - 1));
    const n = j * gw + i;
    xx[n] = gx * gx; yy[n] = gy * gy; xy[n] = gx * gy;
  }
  const blur = (a, rad) => { // separable box blur, twice
    const t = new Float32Array(a.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < gh; j++) { let s = 0; const row = j * gw; for (let i = -rad; i <= rad; i++) s += a[row + clamp(i, 0, gw - 1)]; for (let i = 0; i < gw; i++) { t[row + i] = s / (2 * rad + 1); s += a[row + clamp(i + rad + 1, 0, gw - 1)] - a[row + clamp(i - rad, 0, gw - 1)]; } }
      for (let i = 0; i < gw; i++) { let s = 0; for (let j = -rad; j <= rad; j++) s += t[clamp(j, 0, gh - 1) * gw + i]; for (let j = 0; j < gh; j++) { a[j * gw + i] = s / (2 * rad + 1); s += t[clamp(j + rad + 1, 0, gh - 1) * gw + i] - t[clamp(j - rad, 0, gh - 1) * gw + i]; } }
    }
  };
  blur(xx, 2); blur(yy, 2); blur(xy, 2);
  const ang = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const n = j * gw + i, a = xx[n], b = yy[n], c = xy[n];
    const tr = a + b, det = Math.sqrt((a - b) * (a - b) + 4 * c * c);
    const l1 = (tr + det) / 2, l2 = (tr - det) / 2;
    const strength = Math.min(1, Math.sqrt(l1) / 60);              // edge strength
    const co = l1 + l2 > 1e-6 ? ((l1 - l2) / (l1 + l2)) : 0;         // coherence
    const tangent = 0.5 * Math.atan2(2 * c, a - b) + Math.PI / 2;
    const fa = flow ? flow((i * g + g / 2) / k, (j * g + g / 2) / k) : 0;
    const w = Math.min(1, strength * co * 1.6);
    // blend the doubled angles (orientation, not direction)
    const vx = w * Math.cos(2 * tangent) + (1 - w) * Math.cos(2 * fa), vy = w * Math.sin(2 * tangent) + (1 - w) * Math.sin(2 * fa);
    ang[n] = 0.5 * Math.atan2(vy, vx);
  }
  return { ang, gw, gh, g };
}

/* ---------- main ---------- */
/* scene: { aspect, ground, light, shade, palette, mottle, flow, detail, brushes, threshold, edgeStop, strokeLength,
 *          relief, style, styleAt, coverage, draw(c, rng, dims), overlay?(c, rng, dims), after?(A) }
 * o:     { seed, width, colourVariance, impasto, detail, brushSize, cooperative, onProgress } */
export async function paintScene(scene, o = {}) {
  const t0 = now();
  const seed = o.seed ?? 7, rng = makeRng(seed * 7919 + 13);
  const W = Math.round(o.width ?? 1400), aspect = scene.aspect ?? 0.75, H = Math.round(W * aspect), k = W / 1000;
  const bs = o.brushSize ?? 1, detail = o.detail ?? 1, cv = o.colourVariance ?? 0.15, impasto = o.impasto ?? 1;
  const dims = { W: 1000, H: 1000 * aspect, k };
  let lastYield = now();
  const breathe = o.cooperative
    ? async () => { if (now() - lastYield > 12) { await new Promise((r) => setTimeout(r, 0)); lastYield = now(); } }
    : null;
  // onProgress(fraction, label, extra): `extra` is the underpainting canvas on the "underpainting" call; it may
  // throw to abandon the painting (a newer one was requested)
  const progress = (f, label, extra) => { if (o.onProgress) o.onProgress(f, label, extra); };

  // 1. underpainting
  const under = canvas(W, H), u = under.getContext("2d", { willReadFrequently: true });
  u.save(); u.scale(k, k);
  scene.draw(u, makeRng(seed), dims);
  u.restore();
  // mottle: big soft patches of neighbouring hues so the strokes pick up broken colour
  const mot = scene.mottle ?? 0.12, pal = scene.palette || [scene.light || "#ffd8a8", scene.shade || "#5a5f9a"];
  if (mot > 0) {
    const mr = makeRng(seed + 101);
    for (let i = 0; i < 70; i++) {
      const x = mr.r(0, W), y = mr.r(0, H), rr = mr.r(0.04, 0.16) * W, col = hex(mr.pick(pal));
      const g = u.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(${col},${(mot * mr.r(0.5, 1.2)).toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`);
      u.globalCompositeOperation = mr.chance(0.5) ? "soft-light" : "source-over";
      u.fillStyle = g; u.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    u.globalCompositeOperation = "source-over";
  }
  if (scene.overlay) { u.save(); u.scale(k, k); scene.overlay(u, makeRng(seed + 3), dims); u.restore(); }
  const ref = u.getImageData(0, 0, W, H).data;
  progress(0.05, "underpainting", under);
  if (breathe) await breathe();

  // 2. structure
  const field = orientationField(ref, W, H, Math.max(3, Math.round(4 * k / 1.4)), scene.flow, k);
  const angleAt = (x, y) => { const i = clamp((x / field.g) | 0, 0, field.gw - 1), j = clamp((y / field.g) | 0, 0, field.gh - 1); return field.ang[j * field.gw + i]; };

  // 3. canvas + height map
  const out = canvas(W, H), c = out.getContext("2d", { willReadFrequently: true });
  c.fillStyle = scene.ground || "#b98f63"; c.fillRect(0, 0, W, H);
  const hm = canvas(W, H), h = hm.getContext("2d", { willReadFrequently: true });
  h.fillStyle = "#808080"; h.fillRect(0, 0, W, H);
  const light = hex(scene.light || "#ffd8a8"), shade = hex(scene.shade || "#5a5f9a");
  const detailAt = scene.detail || (() => 1);
  const radii = (scene.brushes || [13, 7.5, 4.2, 2.4, 1.35]).map((r) => r * bs);
  const lenK = scene.strokeLength || 1, edgeStop = scene.edgeStop ?? 30;
  const cover = scene.coverage || 0, coverK = (L) => (L === 1 ? 1 : L === 2 ? 0.75 : 0.4);
  const styleAt = scene.styleAt || (() => scene.style || "loaded");

  const B = new Uint8ClampedArray(W * H * 4), tmp = new Uint8ClampedArray(W * H * 4);
  const half = {};
  let total = 0;
  for (let L = 0; L < radii.length; L++) {
    const rPx = Math.max(1.1, radii[L] * k);
    blurRGBFast(ref, W, H, rPx * 0.55, B, tmp, half);
    // a frame-filling scene starts on its own blurred image instead of a flat ground, so no gap ever shows through
    if (L === 0 && scene.groundFromUnder) c.putImageData(new ImageData(B, W, H), 0, 0);
    const C = c.getImageData(0, 0, W, H).data;
    const step = Math.max(1.4, rPx * (L === 0 ? 1.15 : 1.25));
    const T = L === 0 ? -1 : (scene.threshold ?? 22);
    const fine = L / Math.max(1, radii.length - 1);              // 0 coarse … 1 finest
    const strokes = [];
    for (let y0 = 0; y0 < H; y0 += step) {
      for (let x0 = 0; x0 < W; x0 += step) {
        // detail gating: fine brushes only where the scene wants detail
        const du = detailAt((x0 + step / 2) / k, (y0 + step / 2) / k) * detail;
        const tl = T < 0 ? -1 : T / Math.max(0.05, Math.pow(du, 0.5 + 1.5 * fine));
        let sum = 0, n = 0, best = -1, bx = x0, by = y0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
          const x = Math.min(W - 1, (x0 + (sx + rng.f()) * step / 3) | 0), y = Math.min(H - 1, (y0 + (sy + rng.f()) * step / 3) | 0), q = (y * W + x) * 4;
          const e = Math.hypot(B[q] - C[q], B[q + 1] - C[q + 1], B[q + 2] - C[q + 2]);
          sum += e; n++; if (e > best) { best = e; bx = x; by = y; }
        }
        if (sum / n > tl || (cover > 0 && L > 0 && L < radii.length - 1 && rng.f() < cover * coverK(L) * Math.min(1, du))) strokes.push([bx, by]);
      }
    }
    for (let i = strokes.length - 1; i > 0; i--) { const j = (rng.f() * (i + 1)) | 0; [strokes[i], strokes[j]] = [strokes[j], strokes[i]]; }
    const maxSteps = Math.round([11, 9, 7, 5, 4, 3][Math.min(5, L)] * lenK);
    for (let s = 0; s < strokes.length; s++) {
      // on the main thread, rasterise what is queued (a 1px read flushes the canvas) before deciding to yield,
      // so the drawing cost is spread over many short tasks instead of landing in the next big read
      if (breathe && (s & 63) === 0) { c.getImageData(0, 0, 1, 1); h.getImageData(0, 0, 1, 1); await breathe(); }
      const [x, y] = strokes[s], q = (y * W + x) * 4;
      let st = styleAt(x / k, y / k, L);
      if (st === "dab" && L === 0) st = "loaded";   // impressionists lay in first, then break it up
      let col = [B[q], B[q + 1], B[q + 2]];
      const near = (p) => Math.hypot(B[p] - col[0], B[p + 1] - col[1], B[p + 2] - col[2]) <= edgeStop;
      // path: grow both ways along the field while the underpainting stays close to the stroke colour
      const grow = (sign, steps) => {
        const pts = []; let px = x, py = y;
        const a = angleAt(x, y); let dx = Math.cos(a) * sign, dy = Math.sin(a) * sign;
        const n = Math.ceil(steps / 2 * (0.6 + rng.f() * 0.8));
        for (let i = 0; i < n; i++) {
          const a2 = angleAt(px, py); let ex = Math.cos(a2), ey = Math.sin(a2);
          if (ex * dx + ey * dy < 0) { ex = -ex; ey = -ey; }
          dx = dx * 0.35 + ex * 0.65; dy = dy * 0.35 + ey * 0.65; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
          const nx = px + dx * rPx * 0.85, ny = py + dy * rPx * 0.85;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
          if (!near(((ny | 0) * W + (nx | 0)) * 4)) break;
          px = nx; py = ny; pts.push([px, py]);
        }
        return pts;
      };
      const steps = st === "dab" ? 3 + Math.round(rng.f() * 3 * lenK) : maxSteps;
      const fwd = grow(1, steps), back = st === "dab" ? [] : grow(-1, steps).reverse();
      const path = [...back, [x, y], ...fwd];
      if (path.length === 1) { const a = angleAt(x, y); path.unshift([x - Math.cos(a) * rPx * 0.4, y - Math.sin(a) * rPx * 0.4]); path.push([x + Math.cos(a) * rPx * 0.4, y + Math.sin(a) * rPx * 0.4]); }
      col = brokenColour(col, cv, rng, light, shade, st);
      const u1 = rng.f(), alpha = L === 0 ? 0.97 : 0.74 + rng.f() * 0.24;
      if (st === "dab") drawDab(c, h, path, rPx * (0.8 + u1 * 0.35), col, rng, alpha);
      else drawStroke(c, h, path, rPx * (0.85 + u1 * 0.35), col, rng, alpha);
    }
    total += strokes.length;
    progress(0.1 + 0.8 * (L + 1) / radii.length, `pass ${L + 1}/${radii.length} (${strokes.length})`);
    if (breathe) await breathe();
  }

  // 3b. finishing marks laid by hand on top (star specks, glints), in units
  if (scene.after) {
    const ar = makeRng(seed + 911);
    scene.after({
      W: 1000, H: 1000 * aspect, k, rng: ar, ctx: c,
      stroke(pts, r, colr, alpha = 0.9, style = "loaded") {
        const col = typeof colr === "string" ? hex(colr) : colr, P = pts.map(([px, py]) => [px * k, py * k]);
        if (style === "line") drawLine(c, h, P, r * k, col, alpha);
        else if (style === "dab") drawDab(c, h, P, r * k, col, ar, alpha);
        else drawStroke(c, h, P.length > 1 ? P : [P[0], [P[0][0] + 0.5, P[0][1]]], r * k, col, ar, alpha);
      },
      under(px, py) { const o2 = ((clamp(py * k | 0, 0, H - 1)) * W + clamp(px * k | 0, 0, W - 1)) * 4; return [ref[o2], ref[o2 + 1], ref[o2 + 2]]; },
    });
  }
  if (breathe) await breathe();

  // 4. impasto relief: light the height map from the upper left
  if (impasto > 0) {
    const HD = h.getImageData(0, 0, W, H).data;
    const s = 0.32 * impasto * (scene.relief ?? 1);
    const img = c.getImageData(0, 0, W, H), D = img.data;
    for (let y = 1; y < H - 1; y++) {
      if (breathe && (y & 31) === 0) await breathe();
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        const gx = HD[i + 4] - HD[i - 4], gy = HD[i + W * 4] - HD[i - W * 4];
        const sh = clamp((-gx - gy) * s, -18, 18);
        D[i] = clamp(D[i] + sh); D[i + 1] = clamp(D[i + 1] + sh); D[i + 2] = clamp(D[i + 2] + sh * 0.92);
      }
    }
    c.putImageData(img, 0, 0);
  }
  progress(1, "done");
  return { canvas: out, under, strokes: total, ms: Math.round(now() - t0), width: W, height: H };
}

/* broken colour: a small temperature push, warm in the lights, cool in the darks; 'dab' also splits hues */
function brokenColour(col, cv, rng, light, shade, st) {
  let [hh, ss, ll] = rgb2hsl(col[0], col[1], col[2]);
  hh += rng.gauss() * cv * 0.025; ss = clamp(ss * (1 + rng.gauss() * cv * 0.5), 0, 1); ll = clamp(ll + rng.gauss() * cv * 0.06, 0, 1);
  if (st === "dab" && rng.f() < 0.55) { hh += (rng.f() < 0.5 ? -1 : 1) * (0.025 + rng.f() * 0.05) * cv / 0.15; ss = clamp(ss * 1.18 + 0.04, 0, 1); }
  col = hsl2rgb(hh, ss, ll);
  const tint = ll > 0.62 ? light : ll < 0.38 ? shade : null;
  if (tint) { const m = cv * (0.5 + rng.f() * 1.1) * (ll > 0.62 ? 0.4 + (ll - 0.62) / 0.38 : 0.4 + (0.38 - ll) / 0.38); col = col.map((v, i) => v + (tint[i] - v) * Math.min(0.5, m)); }
  else if (rng.f() < 0.5) { const t2 = rng.f() < 0.5 ? light : shade, m = cv * rng.f() * 0.6; col = col.map((v, i) => v + (t2[i] - v) * m); }
  return col;
}

/* impressionist dab: a short comma, fat and loaded at the head, flicked off into a thin tail */
function drawDab(c, h, path, r, col, rng, alpha) {
  let p = path;
  if (p.length === 1) p = [p[0], [p[0][0] + r * 0.8, p[0][1] + r * 0.3]];
  if (p.length > 2) { const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1]; q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); } q.push(p[p.length - 1]); p = q; }
  const n = p.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const t = i / (n - 1), wv = r * (1 - 0.82 * Math.pow(t, 1.3)) * (0.94 + rng.f() * 0.12);
    left.push([p[i][0] - ty * wv, p[i][1] + tx * wv]); right.push([p[i][0] + ty * wv, p[i][1] - tx * wv]);
  }
  const shape = (ctx) => {
    ctx.beginPath(); for (const q of left) ctx.lineTo(q[0], q[1]); for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]); ctx.closePath();
    const a0 = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
    ctx.moveTo(p[0][0] + Math.cos(a0) * r * 1.25, p[0][1] + Math.sin(a0) * r * 1.25); ctx.ellipse(p[0][0], p[0][1], r * 1.25, r, a0, 0, Math.PI * 2);
  };
  const [R, G, Bc] = col;
  c.fillStyle = `rgba(${R | 0},${G | 0},${Bc | 0},${alpha.toFixed(3)})`; shape(c); c.fill("nonzero");
  h.fillStyle = "rgba(148,148,148,0.85)"; shape(h); h.fill("nonzero");
  // a ridge of thicker paint down the loaded half of the comma (not a disc: discs read as bubble wrap)
  h.strokeStyle = "rgba(178,178,178,0.6)"; h.lineWidth = Math.max(0.6, r * 0.35); h.lineCap = "round";
  h.beginPath(); h.moveTo(p[0][0], p[0][1]); for (let i = 1; i <= Math.max(1, (n / 2) | 0); i++) h.lineTo(p[i][0], p[i][1]); h.stroke();
}

/* a thin, even line of paint laid by hand in after() */
function drawLine(c, h, path, r, col, alpha) {
  c.strokeStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${alpha.toFixed(3)})`; c.lineWidth = r * 2; c.lineCap = "round"; c.lineJoin = "round";
  c.beginPath(); c.moveTo(path[0][0], path[0][1]); for (const q of path.slice(1)) c.lineTo(q[0], q[1]); c.stroke();
  h.strokeStyle = "rgba(175,175,175,0.6)"; h.lineWidth = r * 2; h.beginPath(); h.moveTo(path[0][0], path[0][1]); for (const q of path.slice(1)) h.lineTo(q[0], q[1]); h.stroke();
}

/* a loaded brush: tapered ribbon + bristle streaks; also writes a ridge into the height map */
function drawStroke(c, h, path, r, col, rng, alpha) {
  // smooth the path (one Chaikin pass) for a gestural curve
  let p = path;
  if (p.length > 2) { const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1]; q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); } q.push(p[p.length - 1]); p = q; }
  const n = p.length, left = [], right = [], norms = [];
  const startTaper = 0.35 + rng.f() * 0.3, endTaper = 0.15 + rng.f() * 0.25;
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const t = n === 1 ? 0.5 : i / (n - 1);
    const wv = r * (t < 0.2 ? startTaper + (1 - startTaper) * (t / 0.2) : t > 0.75 ? endTaper + (1 - endTaper) * ((1 - t) / 0.25) : 1) * (0.92 + rng.f() * 0.16);
    norms.push([-ty, tx]);
    left.push([p[i][0] - ty * wv, p[i][1] + tx * wv]); right.push([p[i][0] + ty * wv, p[i][1] - tx * wv]);
  }
  // round the ends a little by extending along the tangent
  const ext = (pt, ref2, d) => { const dx = pt[0] - ref2[0], dy = pt[1] - ref2[1], m = Math.hypot(dx, dy) || 1; return [pt[0] + dx / m * d, pt[1] + dy / m * d]; };
  const head = n > 1 ? ext(p[0], p[1], r * 0.5) : p[0], tail = n > 1 ? ext(p[n - 1], p[n - 2], r * 0.35) : p[0];
  const shape = (ctx) => {
    ctx.beginPath(); ctx.moveTo(head[0], head[1]);
    for (const q of left) ctx.lineTo(q[0], q[1]);
    ctx.lineTo(tail[0], tail[1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
  };
  const [R, G, Bc] = col;
  c.fillStyle = `rgba(${R | 0},${G | 0},${Bc | 0},${alpha.toFixed(3)})`; shape(c); c.fill();
  const hv = 140 + (rng.f() * 30) | 0; h.fillStyle = `rgba(${hv},${hv},${hv},0.85)`; shape(h); h.fill();
  // bristles: streaks of slightly lighter/darker paint along the stroke
  if (r > 1.6) {
    const nb = Math.min(5, 1 + Math.round(r / 2.6));
    for (let b = 0; b < nb; b++) {
      const off = (rng.f() * 2 - 1) * 0.8, dl = (rng.f() < 0.5 ? -1 : 1) * (8 + rng.f() * 14);
      c.strokeStyle = `rgba(${clamp(R + dl) | 0},${clamp(G + dl) | 0},${clamp(Bc + dl * 0.9) | 0},${0.12 + rng.f() * 0.22})`;
      c.lineWidth = Math.max(0.6, r * (0.12 + rng.f() * 0.12)); c.lineCap = "round";
      h.strokeStyle = "rgba(100,100,100,0.5)"; h.lineWidth = Math.max(0.6, r * 0.1);
      const s0 = Math.floor(rng.f() * n * 0.25), s1 = n - Math.floor(rng.f() * n * 0.3);
      c.beginPath(); h.beginPath();
      for (let i = s0; i < Math.max(s0 + 1, s1); i++) {
        const t = n === 1 ? 0.5 : i / (n - 1), taper = t < 0.2 ? 0.6 + t * 2 : t > 0.75 ? 0.4 + (1 - t) * 2.4 : 1;
        const x = p[i][0] + norms[i][0] * r * off * taper, y = p[i][1] + norms[i][1] * r * off * taper;
        if (i === s0) { c.moveTo(x, y); h.moveTo(x, y); } else { c.lineTo(x, y); h.lineTo(x, y); }
      }
      if (n === 1) { c.lineTo(p[0][0] + 0.5, p[0][1]); h.lineTo(p[0][0] + 0.5, p[0][1]); }
      c.stroke(); if (b === 0) h.stroke();
    }
  }
}
