// A gentle five-step mood/energy scale drawn as moon phases (new -> full),
// shared by the reflect form and the memory sheet (issue #11).
// Optional by design: nothing is selected by default and tapping the chosen
// phase again clears it.
import { MOOD_LEVELS, normalizeMood } from "../lib/insights.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

// Lit part of the moon: the right limb plus a terminator ellipse. Level 1 is a
// bare outline, 3 a half moon, 5 a full disc.
const LIT_PATHS = {
  2: "M12 3A9 9 0 0 1 12 21A4.2 9 0 0 0 12 3Z",
  3: "M12 3A9 9 0 0 1 12 21Z",
  4: "M12 3A9 9 0 0 1 12 21A4.2 9 0 0 1 12 3Z",
};

export function createMoodGlyph(level) {
  const glyph = svg("svg", { class: "mood-glyph", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
  glyph.append(svg("circle", { class: "mood-disc", cx: 12, cy: 12, r: 9 }));
  if (level === 5) glyph.append(svg("circle", { class: "mood-lit", cx: 12, cy: 12, r: 9 }));
  else if (LIT_PATHS[level]) glyph.append(svg("path", { class: "mood-lit", d: LIT_PATHS[level] }));
  return glyph;
}

// createMoodPicker({ label, onChange }) -> { el, get(), set(value) }
export function createMoodPicker({ label = "How did it feel? (optional)", onChange } = {}) {
  let value = null;
  const el = document.createElement("div");
  el.className = "mood-picker";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", label);

  const row = document.createElement("div");
  row.className = "mood-row";
  const status = document.createElement("p");
  status.className = "mood-status field-hint";
  status.setAttribute("aria-live", "polite");

  const buttons = MOOD_LEVELS.map(({ value: level, label: name }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mood-btn";
    btn.dataset.mood = String(level);
    btn.setAttribute("aria-label", `${name}, ${level} of 5`);
    btn.setAttribute("aria-pressed", "false");
    btn.append(createMoodGlyph(level));
    const caption = document.createElement("span");
    caption.className = "mood-caption";
    caption.setAttribute("aria-hidden", "true");
    caption.textContent = name;
    btn.append(caption);
    btn.addEventListener("click", () => {
      set(value === level ? null : level);
      if (onChange) onChange(value);
    });
    row.append(btn);
    return btn;
  });

  function set(next) {
    value = normalizeMood(next);
    buttons.forEach((btn) => btn.setAttribute("aria-pressed", String(Number(btn.dataset.mood) === value)));
    status.textContent = value ? `${MOOD_LEVELS[value - 1].label}. Tap again to clear.` : "Skip it, or tap a moon.";
  }

  el.append(row, status);
  set(null);
  return { el, get: () => value, set };
}
