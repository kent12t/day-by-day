/* atlas/sky-scene.js: the Sky Atlas as a studio-style scene (contract from paint-generator/studio/README.md).
 *
 * A moonlit night sky over the whole 1600x900 world: deep ink overhead warming to indigo near the bottom, a milky
 * way sweeping from lower left to upper right with dark dust lanes, nebula clouds tinted by the mix of topics the
 * person has written about, hundreds of faint background stars, and every entry's star as a bright soft glow at its
 * deterministic atlas position (size by depth, hue by topic). The flow field runs along the milky way and curls
 * around entry stars (a little Van Gogh), and detail is high around stars and low in the empty sky.
 *
 * Everything is derived from the node list passed in, so the same entries always paint the same sky. All
 * randomness comes from the painter's seeded rng; never Math.random. */
import { lin, rad, glow, mix, rgba, withAlpha } from "./draw.js";

/* topic -> [star hue, nebula tint]: TOPIC_COLORS curated toward a moonlit palette (paler stars, deeper clouds) */
export const MOONLIT = {
  self: ["#ffe6b0", "#8f7448"],
  relationships: ["#ffc9d6", "#8c4a68"],
  work: ["#c4d4ff", "#3d56a0"],
  body: ["#bff2e4", "#2c7472"],
  gratitude: ["#e8ccff", "#714a9a"],
  dreams: ["#c6ecff", "#2d6894"],
  creativity: ["#ffd496", "#9a5a2c"],
  nature: ["#d0edb0", "#4a7240"],
  spirit: ["#ddd2e6", "#5a4f72"],
  legacy: ["#ffcab0", "#8e4c3e"],
  wildcard: ["#fff2b8", "#857538"],
};
const DEPTH_GLOW = { gentle: 1, deeper: 1.25, bold: 1.5, ethereal: 1.9 };

/* the milky way's spine, in units: lower left to upper right with a slow wave */
const bandY = (x) => 455 - 0.36 * x + 34 * Math.sin(x / 230 + 0.6);
const bandSlope = (x) => -0.36 + (34 / 230) * Math.cos(x / 230 + 0.6);
const bandWidth = (x) => 62 + 26 * Math.sin(x / 170 + 1.9) + 14 * Math.sin(x / 61);

// a tiny value noise for organic band edges and dust (seeded, deterministic)
function valueNoise(seed) {
  const hsh = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1);
    return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
  };
}

/* nodes: [{ x, y, size, topic, depth }] in world coordinates; world: { width, height } */
export function makeSkyScene(nodes, world = { width: 1600, height: 900 }) {
  const s = 1000 / world.width, aspect = world.height / world.width, HU = 1000 * aspect;
  const stars = nodes.map((n) => {
    const [hue, tint] = MOONLIT[n.topic] || MOONLIT.wildcard;
    const r = n.size * s * (DEPTH_GLOW[n.depth] || 1);
    return { x: n.x * s, y: n.y * s, r, hue, tint, topic: n.topic };
  });

  // nebulae: one cloud per topic, around the centroid of that topic's stars, sized by how often it was chosen
  const groups = new Map();
  for (const st of stars) { const g = groups.get(st.topic) || { n: 0, x: 0, y: 0, tint: st.tint, hue: st.hue }; g.n++; g.x += st.x; g.y += st.y; groups.set(st.topic, g); }
  const nebulae = [...groups.values()].map((g) => ({ x: g.x / g.n, y: g.y / g.n, r: 40 + 22 * Math.sqrt(g.n), tint: g.tint, hue: g.hue, w: Math.min(1, 0.45 + g.n * 0.08) }));
  if (!nebulae.length) { // an empty sky still has weather: three faint, quiet clouds
    nebulae.push({ x: 230, y: 300, r: 130, tint: "#4a4a8e", hue: "#c8c4ec", w: 0.9 }, { x: 760, y: 150, r: 120, tint: "#2f647e", hue: "#bfe2f0", w: 0.8 }, { x: 650, y: 460, r: 110, tint: "#70406a", hue: "#e8c4d8", w: 0.7 });
  }

  // flow and detail on a coarse grid (units), looked up by the painter
  const G = 5, gw = Math.ceil(1000 / G) + 1, gh = Math.ceil(HU / G) + 1;
  const flowGrid = new Float32Array(gw * gh), detailGrid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = i * G, y = j * G;
    const db = Math.abs(y - bandY(x)) / bandWidth(x);
    const along = Math.atan(bandSlope(x));
    const breeze = 0.18 * Math.sin(x / 140 + y / 75) + 0.12 * Math.sin(y / 48 - x / 300);
    const wb = Math.exp(-db * db * 0.35);
    let vx = wb * Math.cos(2 * along) + (1 - wb) * Math.cos(2 * (along * 0.4 + breeze));
    let vy = wb * Math.sin(2 * along) + (1 - wb) * Math.sin(2 * (along * 0.4 + breeze));
    let det = 0.5 + 0.35 * Math.exp(-db * db * 0.6);
    for (const st of stars) {
      const dx = x - st.x, dy = y - st.y, d2 = dx * dx + dy * dy, R = 10 + st.r * 5.5;
      if (d2 > R * R * 9) continue;
      const w = Math.exp(-d2 / (R * R)), tang = Math.atan2(dy, dx) + Math.PI / 2;   // curl around the star
      vx += w * 2.2 * Math.cos(2 * tang); vy += w * 2.2 * Math.sin(2 * tang);
      det = Math.max(det, 0.6 + 1.5 * Math.exp(-d2 / (R * R * 0.8)));
    }
    for (const nb of nebulae) {
      const d = Math.hypot(x - nb.x, y - nb.y) / nb.r;
      if (d < 1.4) det = Math.max(det, 0.55 + 0.4 * (1 - d / 1.4));
    }
    flowGrid[j * gw + i] = 0.5 * Math.atan2(vy, vx); detailGrid[j * gw + i] = det;
  }
  const look = (grid, x, y) => grid[Math.min(gh - 1, Math.max(0, Math.round(y / G))) * gw + Math.min(gw - 1, Math.max(0, Math.round(x / G)))];

  return {
    id: "sky-atlas", aspect, groundFromUnder: true,
    ground: "#0a0d22", light: "#ffe9c2", shade: "#141a46",
    palette: ["#283570", "#3a2e68", "#1d4a62", "#4a3760", "#2a2f5a"], mottle: 0.1,
    brushes: [18, 10, 5.4, 2.9], threshold: 20, edgeStop: 26, strokeLength: 1.35, relief: 0.5, coverage: 0.4,
    flow: (x, y) => look(flowGrid, x, y),
    detail: (x, y) => look(detailGrid, x, y),
    style: "loaded",

    draw(c, rng, { W, H }) {
      // 1. sky: ink overhead, indigo low, a cool moonlit wash from the upper left
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, "#04061a"], [0.4, "#0b1034"], [0.78, "#151a48"], [1, "#221e4e"]]);
      c.fillRect(0, 0, W, H);
      glow(c, 90, 20, 520, "#2a3a78", 0.55);
      glow(c, 980, 560, 420, "#3a2558", 0.45);
      glow(c, 520, 600, 380, "#20305e", 0.4);

      // 2. milky way: a wide diffuse river, a milky clumpy core, then broken dust lanes
      const n1 = valueNoise(911), n2 = valueNoise(1733), n3 = valueNoise(2671);
      for (let x = -80; x <= 1080; x += 8) {
        const y = bandY(x), w = bandWidth(x), rot = Math.atan(bandSlope(x)), q = 0.5 + 0.5 * n1(x / 110, 0.5);
        glow(c, x, y, w * 2.6, "#26346e", 0.2, 1.5, rot);
        glow(c, x, y + w * 0.1, w * 1.35, "#56609e", 0.12 + 0.12 * q, 1.6, rot);
        glow(c, x, y + w * 0.05, w * 0.75, "#b4b4d2", 0.07 + 0.13 * q, 1.8, rot);
      }
      for (let i = 0; i < 900; i++) {
        const x = rng.r(-40, 1040), w = bandWidth(x), off = rng.gauss() * w * 0.45, rot = Math.atan(bandSlope(x));
        const px = x - Math.sin(rot) * off, py = bandY(x) + Math.cos(rot) * off;
        const bright = Math.max(0, 1 - Math.abs(off) / (w * 1.1)) * (0.55 + 0.45 * n2(px / 45, py / 45));
        const col = rng.chance(0.3) ? "#f2e6c8" : rng.chance(0.55) ? "#c4c8ea" : "#8f9ad2";
        glow(c, px, py, rng.r(5, 18), col, 0.05 + 0.2 * bright, rng.r(1.1, 2), rot + rng.r(-0.4, 0.4));
      }
      // dust lanes: two rifts that wander along the band, broken where the noise thins them
      for (const [base, amp, sd] of [[0.08, 0.22, 3.3], [-0.42, 0.14, 8.8]]) {
        for (let x = -40; x <= 1040; x += 2.5) {
          const w = bandWidth(x), rot = Math.atan(bandSlope(x));
          const k = n3(x / 46 + sd, sd) * 0.75 + n2(x / 22, sd) * 0.25;
          if (k < -0.1) continue;
          const off = w * (base + amp * n1(x / 90, sd)), px = x - Math.sin(rot) * off, py = bandY(x) + Math.cos(rot) * off;
          glow(c, px, py, w * (0.1 + 0.1 * k), "#06071a", 0.07 + 0.16 * (k + 0.1), 1.35, rot + 0.25 * n1(x / 30, sd + 1));
        }
      }
      // the galactic heart: a warm, milky swell low on the left where the band is widest
      glow(c, 330, bandY(330), 150, "#9a8a96", 0.18, 1.7, Math.atan(bandSlope(330)));
      glow(c, 340, bandY(340) + 6, 80, "#e6d2b0", 0.12, 1.9, Math.atan(bandSlope(340)));
      for (let i = 0; i < 40; i++) { // wisps branching off the rifts
        const x = rng.r(0, 1000), w = bandWidth(x), rot = Math.atan(bandSlope(x)) + rng.r(-1.1, 1.1), off = rng.r(-0.6, 0.6) * w;
        glow(c, x - Math.sin(rot) * off, bandY(x) + Math.cos(rot) * off, rng.r(5, 14), "#080a1c", rng.r(0.18, 0.35), rng.r(2.5, 4.5), rot);
      }

      // 3. nebulae: soft clouds in each topic's tint, a lit rim on the side facing the milky way
      for (const nb of nebulae) {
        const lobes = 12;
        for (let i = 0; i < lobes; i++) {
          const a = rng.r(0, Math.PI * 2), d = Math.sqrt(rng.r(0, 1)) * nb.r * 0.75;
          glow(c, nb.x + Math.cos(a) * d, nb.y + Math.sin(a) * d * 0.7, nb.r * rng.r(0.4, 0.8), mix(nb.tint, "#1a2050", 0.25), nb.w * rng.r(0.12, 0.24), rng.r(1.1, 1.8), rng.r(-0.6, 0.6));
        }
        for (let i = 0; i < 5; i++) {
          const a = rng.r(0, Math.PI * 2), d = rng.r(0.2, 0.6) * nb.r;
          glow(c, nb.x + Math.cos(a) * d, nb.y + Math.sin(a) * d * 0.7, nb.r * rng.r(0.2, 0.38), mix(nb.tint, nb.hue, 0.35), nb.w * rng.r(0.06, 0.14), rng.r(1.2, 2), rng.r(-1, 1));
        }
      }

      // 4. background stars: many faint ones, thicker inside the milky way, a few brighter with halos
      for (let i = 0; i < 1100; i++) {
        let x, y;
        if (rng.chance(0.45)) { x = rng.r(-10, 1010); const w = bandWidth(x); y = bandY(x) + rng.gauss() * w * 0.6; } else { x = rng.r(0, W); y = rng.r(0, H); }
        const m = rng.f(), r = 0.35 + m * m * m * 1.4, col = rng.chance(0.3) ? "#ffe8c8" : rng.chance(0.4) ? "#cfdcff" : "#f4f2ff";
        if (r > 1.4) glow(c, x, y, r * 4, col, 0.1);
        withAlpha(c, 0.12 + 0.25 * m, () => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); });
      }

      // 5. entry stars: a wide coloured bloom, a tighter halo and a white-hot heart
      for (const st of stars) {
        c.fillStyle = rad(c, st.x, st.y, 0, st.r * 7.5, [[0, rgba(st.hue, 0)], [0.38, rgba(st.hue, 0)], [0.46, rgba(st.hue, 0.13)], [0.55, rgba(st.hue, 0)], [0.7, rgba(st.hue, 0.07)], [0.8, rgba(st.hue, 0)], [1, rgba(st.hue, 0)]]);
        c.fillRect(st.x - st.r * 7.5, st.y - st.r * 7.5, st.r * 15, st.r * 15);
        glow(c, st.x, st.y, st.r * 5.5, st.tint, 0.3);
        glow(c, st.x, st.y, st.r * 3.4, st.hue, 0.45);
        c.fillStyle = rad(c, st.x, st.y, 0, st.r * 1.8, [[0, "#ffffff"], [0.45, rgba(st.hue, 1)], [1, rgba(st.hue, 0)]]);
        c.fillRect(st.x - st.r * 2, st.y - st.r * 2, st.r * 4, st.r * 4);
      }
    },

    // finishing marks: flicked specks of paint for the faint stars (the brushes smear anything under ~2 units)
    after(A) {
      const { rng } = A;
      for (let i = 0; i < 520; i++) {
        let x, y;
        if (rng.chance(0.5)) { x = rng.r(0, 1000); y = bandY(x) + rng.gauss() * bandWidth(x) * 0.55; } else { x = rng.r(0, 1000); y = rng.r(0, A.H); }
        if (y < 0 || y > A.H) continue;
        const m = rng.f(), r = 0.32 + m * m * 0.75, col = rng.chance(0.3) ? "#ffeccc" : rng.chance(0.4) ? "#d6e0ff" : "#f8f6ff";
        A.stroke([[x, y], [x + rng.r(-0.4, 0.4), y + rng.r(-0.4, 0.4)]], r, col, 0.45 + 0.5 * m, "line");
        if (m > 0.975) { // a few brighter ones get a soft four-point glint
          const L = r * rng.r(3, 5);
          A.stroke([[x - L, y], [x + L, y]], r * 0.2, col, 0.25, "line");
          A.stroke([[x, y - L], [x, y + L]], r * 0.2, col, 0.25, "line");
        }
      }
    },
  };
}
