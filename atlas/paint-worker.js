/* atlas/paint-worker.js: paints the Sky Atlas off the main thread with OffscreenCanvas.
 * In:  { id, nodes, world, width, seed, colourVariance }
 * Out: { id, type: "under", bitmap }            the underpainting, as soon as it exists (a soft preview)
 *      { id, type: "done", bitmap, ms, strokes } the finished painting
 *      { id, type: "blob", blob }                the painting encoded for the IndexedDB cache
 *      { id, type: "error", message }            the caller then falls back to the main thread */
import { paintScene } from "./brush.js";
import { makeSkyScene } from "./sky-scene.js";

self.onmessage = async (event) => {
  const { id, nodes, world, width, seed, colourVariance } = event.data;
  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is not available in this worker");
    let sentUnder = false;
    const scene = makeSkyScene(nodes, world);
    const res = await paintScene(scene, {
      seed, width, colourVariance,
      onProgress: (f, label, under) => {
        if (sentUnder || label !== "underpainting" || !under) return;
        sentUnder = true;
        // synchronous on purpose: the painter does not yield in a worker, so a promise would resolve too late.
        // The painter has already read the underpainting's pixels, so handing over its bitmap is safe.
        const bitmap = under.transferToImageBitmap();
        self.postMessage({ id, type: "under", bitmap }, [bitmap]);
      },
    });
    const bitmap = await createImageBitmap(res.canvas);
    self.postMessage({ id, type: "done", bitmap, ms: res.ms, strokes: res.strokes }, [bitmap]);
    try {
      const blob = await res.canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
      self.postMessage({ id, type: "blob", blob });
    } catch (err) {
      // encoding is only for the cache; the painting itself is already delivered
    }
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
