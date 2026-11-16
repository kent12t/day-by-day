/* scripts/generate-icons.cjs: renders the PWA PNG icons in public/ from public/moon-atlas-icon.svg.
 *
 * Run only when the SVG changes; the PNGs are committed. Needs Playwright with Chromium available
 * (not a project dependency):  node scripts/generate-icons.cjs
 *
 *   icon-192.png, icon-512.png      the SVG as drawn (rounded square, transparent corners), purpose "any"
 *   icon-maskable-512.png           full-bleed background, artwork scaled into the 80% safe zone
 *   apple-touch-icon.png (180)      full-bleed square; iOS applies its own rounding */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(root, "public/moon-atlas-icon.svg"), "utf8");
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const defs = inner.match(/<defs>[\s\S]*?<\/defs>/)[0];
const art = inner.replace(defs, "").replace(/<rect[^>]*\/>/, ""); // drop the rounded background

// Full-bleed square background with the artwork scaled about the centre.
function fullBleed(scale) {
  const offset = (256 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${defs}
  <rect width="256" height="256" fill="url(#bg)" />
  <g transform="translate(${offset} ${offset}) scale(${scale})">${art}</g></svg>`;
}

const outputs = [
  { file: "icon-192.png", size: 192, markup: svg },
  { file: "icon-512.png", size: 512, markup: svg },
  { file: "icon-maskable-512.png", size: 512, markup: fullBleed(0.78) },
  { file: "apple-touch-icon.png", size: 180, markup: fullBleed(0.9) },
];

(async () => {
  const browser = await chromium.launch();
  try {
    for (const { file, size, markup } of outputs) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      const sized = markup.replace(/<svg /, `<svg width="${size}" height="${size}" `);
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`
      );
      await page.screenshot({
        path: path.join(root, "public", file),
        omitBackground: true,
        clip: { x: 0, y: 0, width: size, height: size },
      });
      await page.close();
      console.log(`wrote public/${file}`);
    }
  } finally {
    await browser.close();
  }
})();
