import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hex, makeRng, mulberry32, paintScene } from "../../atlas/brush.js";
import { mix, rgb, rgba } from "../../atlas/draw.js";
import { MOONLIT, makeSkyScene } from "../../atlas/sky-scene.js";
import { PAINT_VERSION, paintKey } from "../../atlas/sky-painter.js";

const WORLD = { width: 1600, height: 900 };
const NODES = [
  { id: "a", x: 320, y: 410, size: 6, topic: "self", depth: "gentle" },
  { id: "b", x: 1180, y: 210, size: 8, topic: "dreams", depth: "ethereal" },
  { id: "c", x: 760, y: 640, size: 7, topic: "self", depth: "bold" },
];

// A 2D context stand-in that records every call and property write, so a scene's
// underpainting can be compared without a real canvas.
function recordingContext() {
  const log = [];
  const gradient = (kind, args) => {
    log.push([kind, ...args]);
    return { addColorStop: (t, col) => log.push(["stop", t, col]) };
  };
  const target = {
    createLinearGradient: (...args) => gradient("linear", args),
    createRadialGradient: (...args) => gradient("radial", args),
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "globalAlpha") return obj._alpha ?? 1;
      return (...args) => log.push([prop, ...args]);
    },
    set(obj, prop, value) {
      if (prop === "globalAlpha") obj._alpha = value;
      log.push(["set", prop, typeof value === "object" ? "[gradient]" : value]);
      return true;
    },
  });
  return { ctx, log };
}

function drawUnder(nodes, seed) {
  const scene = makeSkyScene(nodes, WORLD);
  const { ctx, log } = recordingContext();
  scene.draw(ctx, makeRng(seed), { W: 1000, H: 1000 * scene.aspect, k: 1 });
  return log;
}

function runAfter(nodes, seed) {
  const scene = makeSkyScene(nodes, WORLD);
  const strokes = [];
  scene.after({ W: 1000, H: 1000 * scene.aspect, k: 1, rng: makeRng(seed), stroke: (...args) => strokes.push(args) });
  return strokes;
}

describe("seeded randomness", () => {
  it("mulberry32 produces the same sequence for the same seed, in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
    seqA.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
    const c = mulberry32(43);
    expect(Array.from({ length: 100 }, () => c())).not.toEqual(seqA);
  });

  it("makeRng helpers are deterministic and stay in range", () => {
    const sample = (seed) => {
      const rng = makeRng(seed);
      return Array.from({ length: 50 }, () => [rng.r(5, 10), rng.gauss(), rng.chance(0.5), rng.pick(["x", "y", "z"])]);
    };
    expect(sample(7)).toEqual(sample(7));
    expect(sample(7)).not.toEqual(sample(8));
    sample(7).forEach(([r, g, , p]) => {
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThan(10);
      expect(Number.isFinite(g)).toBe(true);
      expect(["x", "y", "z"]).toContain(p);
    });
  });
});

describe("colour helpers", () => {
  it("parses and mixes hex colours", () => {
    expect(hex("#ff8000")).toEqual([255, 128, 0]);
    expect(hex("#f80")).toEqual([255, 136, 0]);
    expect(rgb("#0a0d22")).toEqual([10, 13, 34]);
    expect(rgba("#ffffff", 0.5)).toBe("rgba(255,255,255,0.5)");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mix("#123456", "#abcdef", 1)).toBe("#abcdef");
  });

  it("has a moonlit colour pair for every topic plus wildcard", () => {
    for (const topic of [
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
    ]) {
      expect(MOONLIT[topic]).toHaveLength(2);
      MOONLIT[topic].forEach((col) => expect(col).toMatch(/^#[0-9a-f]{6}$/));
    }
  });
});

describe("sky scene determinism", () => {
  it("draws an identical underpainting for identical nodes and seed", () => {
    const a = drawUnder(NODES, 7);
    const b = drawUnder(
      NODES.map((n) => ({ ...n })),
      7
    );
    expect(a.length).toBeGreaterThan(1000);
    expect(a).toEqual(b);
  });

  it("changes when the seed or the entries change", () => {
    const base = drawUnder(NODES, 7);
    expect(drawUnder(NODES, 8)).not.toEqual(base);
    expect(drawUnder(NODES.slice(0, 2), 7)).not.toEqual(base);
    expect(drawUnder([{ ...NODES[0], topic: "work" }, ...NODES.slice(1)], 7)).not.toEqual(base);
  });

  it("paints an empty sky deterministically too", () => {
    expect(drawUnder([], 7)).toEqual(drawUnder([], 7));
  });

  it("lays identical finishing marks for the same seed", () => {
    const a = runAfter(NODES, 918);
    expect(a.length).toBeGreaterThan(100);
    expect(runAfter(NODES, 918)).toEqual(a);
    expect(runAfter(NODES, 919)).not.toEqual(a);
  });

  it("derives flow and detail fields purely from the nodes", () => {
    const s1 = makeSkyScene(NODES, WORLD);
    const s2 = makeSkyScene(NODES, WORLD);
    const probes = [
      [0, 0],
      [200, 256],
      [737, 131],
      [999, 560],
    ];
    probes.forEach(([x, y]) => {
      expect(s1.flow(x, y)).toBe(s2.flow(x, y));
      expect(s1.detail(x, y)).toBe(s2.detail(x, y));
      expect(Number.isFinite(s1.flow(x, y))).toBe(true);
    });
    expect(s1.aspect).toBeCloseTo(900 / 1600);
  });
});

describe("paintKey", () => {
  it("is stable for the same nodes and includes version and count", () => {
    const key = paintKey(NODES, WORLD, 1600);
    expect(key).toBe(
      paintKey(
        NODES.map((n) => ({ ...n })),
        WORLD,
        1600
      )
    );
    expect(key.startsWith(`sky-${PAINT_VERSION}-${NODES.length}-`)).toBe(true);
  });

  it("changes with anything the painting depends on", () => {
    const key = paintKey(NODES, WORLD, 1600);
    const moved = NODES.map((n, i) => (i === 1 ? { ...n, x: n.x + 1 } : n));
    expect(paintKey(moved, WORLD, 1600)).not.toBe(key);
    expect(paintKey([{ ...NODES[0], depth: "deeper" }, ...NODES.slice(1)], WORLD, 1600)).not.toBe(key);
    expect(paintKey([{ ...NODES[0], id: "z" }, ...NODES.slice(1)], WORLD, 1600)).not.toBe(key);
    expect(paintKey([...NODES].reverse(), WORLD, 1600)).not.toBe(key);
    expect(paintKey(NODES, WORLD, 1200)).not.toBe(key);
    expect(paintKey(NODES, { width: 1600, height: 1000 }, 1600)).not.toBe(key);
  });

  it("ignores sub-precision jitter in positions", () => {
    const jittered = NODES.map((n) => ({ ...n, x: n.x + 0.001 }));
    expect(paintKey(jittered, WORLD, 1600)).toBe(paintKey(NODES, WORLD, 1600));
  });
});

// Full brush-engine render with node-canvas standing in for OffscreenCanvas.
// Skipped automatically if the native `canvas` package is unavailable.
let nodeCanvas = null;
try {
  nodeCanvas = await import("canvas");
} catch {
  nodeCanvas = null;
}

describe.skipIf(!nodeCanvas)("paintScene (node-canvas)", () => {
  const saved = {};
  beforeAll(() => {
    saved.OffscreenCanvas = globalThis.OffscreenCanvas;
    saved.ImageData = globalThis.ImageData;
    const { createCanvas, ImageData } = nodeCanvas;
    globalThis.ImageData = ImageData;
    globalThis.OffscreenCanvas = function OffscreenCanvas(w, h) {
      return createCanvas(w, h);
    };
  });
  afterAll(() => {
    globalThis.OffscreenCanvas = saved.OffscreenCanvas;
    globalThis.ImageData = saved.ImageData;
  });

  async function paintHash(nodes, seed) {
    const res = await paintScene(makeSkyScene(nodes, WORLD), { seed, width: 160 });
    const pixels = res.canvas.getContext("2d").getImageData(0, 0, res.width, res.height).data;
    return { hash: createHash("sha1").update(pixels).digest("hex"), strokes: res.strokes, res };
  }

  it("renders byte-identical paintings for identical entries and seed", async () => {
    const a = await paintHash(NODES, 7);
    const b = await paintHash(
      NODES.map((n) => ({ ...n })),
      7
    );
    expect(a.res.width).toBe(160);
    expect(a.res.height).toBe(90);
    expect(a.strokes).toBeGreaterThan(0);
    expect(b.strokes).toBe(a.strokes);
    expect(b.hash).toBe(a.hash);
  }, 30000);

  it("renders a different painting for a different seed", async () => {
    const a = await paintHash(NODES, 7);
    const b = await paintHash(NODES, 8);
    expect(b.hash).not.toBe(a.hash);
  }, 30000);
});
