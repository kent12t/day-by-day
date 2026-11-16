/* atlas/atlas-view.js: the Sky Atlas on screen.
 *
 * Two layers share the atlas's pan/zoom transform:
 *   - behind the SVG, a painted night sky (two <canvas> elements in one transformed <div>), produced by
 *     sky-painter.js off the main thread and crossfaded in when ready;
 *   - in the SVG, the crisp live elements: luminous star cores (focusable buttons), tapered gold-ink
 *     constellation strokes, the new-entry burst and the milestone comet.
 * Until a painting exists the SVG's own gradient (#skyBase) stands in, so the atlas is never empty. */
import { requestSkyPainting } from "./sky-painter.js";
import { MOONLIT } from "./sky-scene.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FADE_MS = 900;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const prefersReducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (err) { return false; }
};

/* ---------- painted background ---------- */
export function createPaintedSky({ svg, world, paintScale = 1 }) {
  const host = svg.parentElement;
  const layer = document.createElement("div");
  layer.className = "atlas-paint";
  layer.setAttribute("aria-hidden", "true");
  layer.style.width = `${world.width}px`;
  layer.style.height = `${world.height}px`;
  const width = Math.round(world.width * paintScale), height = Math.round(world.height * paintScale);
  const makeCanvas = (cls) => { const c = document.createElement("canvas"); c.className = cls; c.width = width; c.height = height; layer.append(c); return c; };
  const base = makeCanvas("atlas-paint-base");   // what is showing now (underpainting or the last painting)
  const top = makeCanvas("atlas-paint-top");     // the new painting, fading in over it
  host.insertBefore(layer, svg);

  let currentKey = "";
  let wantedSignature = null;
  let baseFilled = false;
  let fadeTimer = 0;

  const draw = (canvas, image) => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
  };
  const markPainted = () => {
    baseFilled = true;
    host.classList.add("is-painted");
  };
  const showInstantly = (image) => {
    clearTimeout(fadeTimer);
    draw(base, image);
    top.classList.remove("is-visible", "is-fading");
    markPainted();
  };
  const crossfade = (image) => {
    if (prefersReducedMotion() || !baseFilled) {
      // nothing underneath to fade from (or motion is unwelcome): the gradient fades out via CSS, or not at all
      showInstantly(image);
      return;
    }
    clearTimeout(fadeTimer);
    draw(top, image);
    top.classList.remove("is-visible");
    top.classList.add("is-fading");
    void top.offsetWidth; // start the transition from opacity 0
    top.classList.add("is-visible");
    fadeTimer = setTimeout(() => {
      draw(base, top);
      top.classList.remove("is-visible", "is-fading");
    }, FADE_MS + 60);
  };

  return {
    /* nodes: [{ id, x, y, size, topic, depth }] — repaints only when they change, never on pan/zoom/resize */
    async update(nodes) {
      const signature = nodes.map((n) => `${n.id}:${n.topic}:${n.depth}:${n.x.toFixed(1)},${n.y.toFixed(1)}`).join("|");
      if (signature === wantedSignature) return;
      wantedSignature = signature;
      const t0 = performance.now();
      const result = await requestSkyPainting(nodes, {
        world, width,
        onUnder: (image) => { if (!baseFilled) showInstantly(image); }, // only as a first preview, never over a painting
      });
      if (!result || signature !== wantedSignature || result.key === currentKey) return;
      currentKey = result.key;
      if (result.from === "memory" || result.from === "indexeddb") showInstantly(result.image);
      else crossfade(result.image);
      svg.dataset.paintMs = String(Math.round(performance.now() - t0));
      svg.dataset.paintFrom = result.from;
      svg.dataset.paintKey = result.key;
    },
    /* mirror the SVG world transform (world units -> CSS pixels) */
    setTransform(zoom, x, y, viewportWidth, viewportHeight) {
      // the same rounding the SVG matrix uses, so the painting and the star cores never drift apart
      zoom = Number(zoom.toFixed(3)); x = Number(x.toFixed(2)); y = Number(y.toFixed(2));
      const sx = (svg.clientWidth || viewportWidth) / viewportWidth, sy = (svg.clientHeight || viewportHeight) / viewportHeight;
      layer.style.transform = `translate(${(x * sx).toFixed(2)}px, ${(y * sy).toFixed(2)}px) scale(${(zoom * sx).toFixed(4)}, ${(zoom * sy).toFixed(4)})`;
    },
  };
}

/* ---------- crisp live elements ---------- */
function ensureDefs(svg) {
  const defs = svg.querySelector("defs") || svg.insertBefore(svgEl("defs"), svg.firstChild);
  if (defs.querySelector("#starHalo-self")) return;
  for (const [topic, [hue]] of Object.entries(MOONLIT)) {
    const g = svgEl("radialGradient", { id: `starHalo-${topic}` });
    g.append(svgEl("stop", { offset: "0%", "stop-color": "#fffaf0", "stop-opacity": "0.95" }));
    g.append(svgEl("stop", { offset: "22%", "stop-color": hue, "stop-opacity": "0.75" }));
    g.append(svgEl("stop", { offset: "60%", "stop-color": hue, "stop-opacity": "0.16" }));
    g.append(svgEl("stop", { offset: "100%", "stop-color": hue, "stop-opacity": "0" }));
    defs.append(g);
  }
  const comet = svgEl("linearGradient", { id: "cometTail", gradientUnits: "userSpaceOnUse", x1: "180", y1: "140", x2: "1340", y2: "210" });
  comet.append(svgEl("stop", { offset: "0%", "stop-color": "#ffe9c2", "stop-opacity": "0" }));
  comet.append(svgEl("stop", { offset: "75%", "stop-color": "#ffe9c2", "stop-opacity": "0.35" }));
  comet.append(svgEl("stop", { offset: "100%", "stop-color": "#fff8ea", "stop-opacity": "0.9" }));
  defs.append(comet);
}

/* a tapered ink stroke between two stars: a thin lens, slightly bowed, its ends tucked in short of the cores */
function inkStrokePath(a, b, width, bow) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const ia = Math.min(len * 0.3, a.size * 1.6 + 3), ib = Math.min(len * 0.3, b.size * 1.6 + 3);
  const p0 = [a.x + ux * ia, a.y + uy * ia], p1 = [b.x - ux * ib, b.y - uy * ib];
  const mx = (p0[0] + p1[0]) / 2 + nx * bow * len, my = (p0[1] + p1[1]) / 2 + ny * bow * len;
  const w = width / 2;
  const f = (v) => v.toFixed(1);
  return `M ${f(p0[0])} ${f(p0[1])} Q ${f(mx + nx * w * 2)} ${f(my + ny * w * 2)} ${f(p1[0])} ${f(p1[1])} Q ${f(mx - nx * w * 2)} ${f(my - ny * w * 2)} ${f(p0[0])} ${f(p0[1])} Z`;
}

/* a comet along the old milestone arc: a tapered tail swelling into a bright head */
function cometPath() {
  const P0 = [180, 140], C = [680, 50], P1 = [1340, 210], N = 28, left = [], right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = u * u * P0[0] + 2 * u * t * C[0] + t * t * P1[0], y = u * u * P0[1] + 2 * u * t * C[1] + t * t * P1[1];
    const tx = 2 * u * (C[0] - P0[0]) + 2 * t * (P1[0] - C[0]), ty = 2 * u * (C[1] - P0[1]) + 2 * t * (P1[1] - C[1]), m = Math.hypot(tx, ty) || 1;
    const w = 0.2 + 3.4 * Math.pow(t, 2.2);
    left.push([x - (ty / m) * w, y + (tx / m) * w]); right.push([x + (ty / m) * w, y - (tx / m) * w]);
  }
  const pts = [...left, ...right.reverse()].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`);
  return `M ${pts.join(" L ")} Z`;
}

/* The atlas captures the pointer on pointerdown (for dragging), and with capture Chromium sends the click to the
 * <svg> instead of the star under the pointer. Find the star under the click and activate it here; clicks that do
 * reach a star (other browsers) are handled by the star itself. */
const activators = new WeakMap();
const delegated = new WeakSet();
function delegateCapturedClicks(svg) {
  if (delegated.has(svg)) return;
  delegated.add(svg);
  svg.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".atlas-star")) return;
    const hit = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.closest && el.closest(".atlas-star"));
    const star = hit && hit.closest(".atlas-star");
    const activate = star && activators.get(star);
    if (activate) activate(event);
  });
}

/* renderAtlasOverlay({ svg, linkLayer, nodeLayer, eventLayer, nodes, links, entries, labels, newEntry, milestone,
 *                      onSelect(entry, event), isClickBlocked() }) */
export function renderAtlasOverlay(o) {
  ensureDefs(o.svg);
  delegateCapturedClicks(o.svg);

  o.links.forEach((link, i) => {
    const bow = ((i * 7919) % 11 - 5) / 120; // deterministic gentle bow, either side
    const path = svgEl("path", {
      d: inkStrokePath(link.from, link.to, link.strength * 1.25, bow),
      fill: link.strength > 1 ? "rgba(240, 206, 140, 0.4)" : "rgba(226, 200, 160, 0.22)",
    });
    path.classList.add("atlas-ink");
    o.linkLayer.append(path);
  });

  o.nodes.forEach((node, index) => {
    const entry = o.entries[index];
    const label = o.labels[node.topic] || node.topic;
    const star = svgEl("g", { class: "atlas-star", tabindex: "0", role: "button", "aria-label": `${label} entry` });
    star.append(svgEl("circle", { class: "atlas-star-hit", cx: node.x, cy: node.y, r: Math.max(12, node.size * 2.4), fill: "transparent" }));
    const glow = svgEl("g", { class: "node" });
    glow.style.animationDelay = `${(index % 9) * 0.31}s`;
    glow.append(svgEl("circle", { cx: node.x, cy: node.y, r: (node.size * 1.9).toFixed(2), fill: `url(#starHalo-${MOONLIT[node.topic] ? node.topic : "wildcard"})` }));
    const s = node.size * 1.5, t = node.size * 0.16;
    glow.append(svgEl("path", {
      class: "atlas-star-glint",
      d: `M ${node.x} ${node.y - s} L ${node.x + t} ${node.y - t} L ${node.x + s} ${node.y} L ${node.x + t} ${node.y + t} L ${node.x} ${node.y + s} L ${node.x - t} ${node.y + t} L ${node.x - s} ${node.y} L ${node.x - t} ${node.y - t} Z`,
      fill: "rgba(255, 248, 232, 0.55)",
    }));
    glow.append(svgEl("circle", { cx: node.x, cy: node.y, r: (node.size * 0.36).toFixed(2), fill: "#fffaf0" }));
    star.append(glow);
    const activate = (event) => { if (!o.isClickBlocked()) o.onSelect(entry, event); };
    activators.set(star, activate);
    star.addEventListener("click", activate);
    star.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const r = star.getBoundingClientRect();
      o.onSelect(entry, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, target: star });
    });
    o.nodeLayer.append(star);
  });

  if (o.newEntry && o.nodes.length) {
    const fresh = o.nodes[o.nodes.length - 1];
    for (const [r, w, delay] of [[22, 2, 0], [34, 1.2, 0.18]]) {
      const burst = svgEl("circle", { cx: fresh.x, cy: fresh.y, r, fill: "none", stroke: "rgba(253, 218, 166, 0.82)", "stroke-width": w });
      burst.classList.add("new-burst");
      burst.style.animationDelay = `${delay}s`;
      o.eventLayer.append(burst);
    }
  }

  if (o.milestone) {
    const comet = svgEl("g", { class: "atlas-comet" });
    comet.append(svgEl("path", { d: cometPath(), fill: "url(#cometTail)" }));
    comet.append(svgEl("circle", { cx: 1340, cy: 210, r: 9, fill: "rgba(255, 233, 194, 0.25)" }));
    comet.append(svgEl("circle", { cx: 1340, cy: 210, r: 3.2, fill: "#fff8ea" }));
    o.eventLayer.append(comet);
  }
}
