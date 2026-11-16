// The Insights sheet (issue #11): topic balance, a calendar of nights reflected,
// mood over time and "on this day", all computed locally from the entries.
// DOM only; the numbers come from lib/insights.js.
import { closeDialog, openDialog } from "../lib/dialog.js";
import {
  MOOD_SPARKLINE_MIN,
  absenceSentence,
  buildHeatmap,
  leastVisitedTopic,
  moodAverage,
  moodLabel,
  moodSeries,
  nightsInMonth,
  onThisDay,
  topicCountsInWindow,
} from "../lib/insights.js";
import { excerptFor } from "../lib/memories.js";
import { createMoodGlyph } from "./mood-picker.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HEATMAP_WEEKS = 12;
const WINDOW_DAYS = 30;
const SPARK_POINTS = 40;

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(title, id) {
  const section = el("section", "insight-card");
  const heading = el("h4", "insight-title", title);
  heading.id = id;
  section.setAttribute("aria-labelledby", id);
  section.append(heading);
  return section;
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- topic balance: a radial wheel of the last 30 days ---------- */
function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function wedgePath(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
  const f = (v) => v.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`;
}

function buildWheel({ topics, labels, counts, total }) {
  const size = 240, c = size / 2, r0 = 36, rMax = 108;
  const max = Math.max(1, ...topics.map((t) => counts[t]));
  const summary = total
    ? `Reflections by topic over the last ${WINDOW_DAYS} days: ${topics.map((t) => `${labels[t]} ${counts[t]}`).join(", ")}.`
    : `No reflections in the last ${WINDOW_DAYS} days yet.`;
  const wheel = svg("svg", { class: "insight-wheel", viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": summary });

  wheel.append(svg("circle", { class: "wheel-ring", cx: c, cy: c, r: rMax }));
  wheel.append(svg("circle", { class: "wheel-ring faint", cx: c, cy: c, r: (r0 + rMax) / 2 }));
  wheel.append(svg("circle", { class: "wheel-ring", cx: c, cy: c, r: r0 }));

  const step = 360 / topics.length, gap = 5;
  topics.forEach((topic, i) => {
    const a0 = i * step + gap / 2, a1 = (i + 1) * step - gap / 2;
    const count = counts[topic];
    if (count) {
      const len = 6 + (rMax - r0 - 6) * Math.sqrt(count / max);
      const wedge = svg("path", { class: "wheel-wedge", d: wedgePath(c, c, r0 + 3, r0 + 3 + len, a0, a1) });
      wedge.style.fill = `var(--${topic})`;
      const tip = svg("title");
      tip.textContent = `${labels[topic]}: ${plural(count, "reflection")}`;
      wedge.append(tip);
      wheel.append(wedge);
    } else {
      // an untouched topic keeps a quiet outlined notch, so absence is visible without colour
      const notch = svg("path", { class: "wheel-notch", d: wedgePath(c, c, r0 + 3, r0 + 9, a0, a1) });
      notch.style.stroke = `var(--${topic})`;
      wheel.append(notch);
    }
  });

  const big = svg("text", { class: "wheel-total", x: c, y: c + 2, "text-anchor": "middle" });
  big.textContent = String(total);
  const small = svg("text", { class: "wheel-unit", x: c, y: c + 16, "text-anchor": "middle" });
  small.textContent = total === 1 ? "star" : "stars";
  wheel.append(big, small);
  return wheel;
}

function buildBalance(ctx) {
  const { entries, topics, labels, now, onReflectTopic } = ctx;
  const section = card(`Topic balance, last ${WINDOW_DAYS} days`, "insightBalanceTitle");
  const { counts, total } = topicCountsInWindow(entries, topics, { now, days: WINDOW_DAYS });

  const layout = el("div", "balance-layout");
  layout.append(buildWheel({ topics, labels, counts, total }));
  const legend = el("ul", "balance-legend");
  topics.forEach((topic) => {
    const item = el("li", "balance-item");
    item.dataset.topic = topic;
    const dot = el("span", "topic-dot");
    dot.setAttribute("aria-hidden", "true");
    item.append(dot, el("span", "balance-name", labels[topic]), el("span", "balance-count", String(counts[topic])));
    legend.append(item);
  });
  layout.append(legend);
  section.append(layout);

  const away = leastVisitedTopic(entries, topics, now);
  const sentence = away ? absenceSentence(labels[away.topic], away.daysSince) : null;
  const note = el("p", "insight-sentence", sentence || (entries.length ? "Your sky feels evenly tended lately." : "Your first reflection will start the wheel turning."));
  section.append(note);
  if (sentence) {
    const btn = el("button", "secondary-btn insight-action", `Reflect on ${labels[away.topic]}`);
    btn.type = "button";
    btn.dataset.topic = away.topic;
    btn.dataset.focusKey = "reflect";
    btn.addEventListener("click", () => onReflectTopic(away.topic));
    section.append(btn);
  }
  return section;
}

/* ---------- calendar heatmap of nights reflected ---------- */
function buildCalendar(ctx) {
  const { entries, now } = ctx;
  const section = card(`Nights reflected, last ${HEATMAP_WEEKS} weeks`, "insightCalendarTitle");
  const heat = buildHeatmap(entries, { now, weeks: HEATMAP_WEEKS });
  const month = nightsInMonth(entries, now);

  const wrap = el("div", "heatmap-wrap");
  const table = el("table", "heatmap");
  const caption = el("caption", "sr-only", `Nights reflected over the last ${HEATMAP_WEEKS} weeks. Each row is a weekday, each column a week.`);
  table.append(caption);

  const head = el("thead");
  const headRow = el("tr");
  headRow.append(el("td", "heat-corner"));
  let lastMonth = -1;
  heat.weeks.forEach((week) => {
    const th = el("th", "heat-month");
    th.scope = "col";
    const m = week[0].date.getMonth();
    if (m !== lastMonth) {
      th.textContent = week[0].date.toLocaleDateString(undefined, { month: "short" });
      lastMonth = m;
    } else {
      th.append(el("span", "sr-only", `Week of ${week[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`));
    }
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);

  const body = el("tbody");
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((d) => heat.weeks[0][d].date.toLocaleDateString(undefined, { weekday: "short" }));
  dayNames.forEach((name, d) => {
    const row = el("tr");
    const th = el("th", d % 2 === 0 ? "heat-day" : "heat-day sr-only", name);
    th.scope = "row";
    row.append(th);
    heat.weeks.forEach((week) => {
      const day = week[d];
      const td = el("td", "heat-cell");
      const when = day.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      if (day.future) {
        td.classList.add("future");
        td.setAttribute("aria-label", `${when}: upcoming`);
      } else {
        const level = Math.min(day.count, 2);
        td.dataset.level = String(level);
        td.setAttribute("aria-label", day.count ? `${when}: ${plural(day.count, "reflection")}` : `${when}: no reflection`);
        const mark = el("span", "heat-mark");
        mark.setAttribute("aria-hidden", "true");
        td.append(mark);
        if (day.today) td.classList.add("today");
      }
      row.append(td);
    });
    body.append(row);
  });
  table.append(body);
  wrap.append(table);
  section.append(wrap);

  const key = el("p", "heat-key");
  key.setAttribute("aria-hidden", "true");
  for (const [level, text] of [["0", "quiet"], ["1", "a reflection"], ["2", "more than one"]]) {
    const item = el("span", "heat-key-item");
    const mark = el("span", "heat-mark");
    mark.dataset.level = level;
    item.append(mark, document.createTextNode(` ${text}`));
    key.append(item);
  }
  section.append(key);

  const monthName = now.toLocaleDateString(undefined, { month: "long" });
  section.append(
    el("p", "insight-sentence", month ? `${plural(month, "night")} reflected this month.` : `No nights yet in ${monthName}. Whenever you are ready.`)
  );
  return section;
}

/* ---------- mood over time ---------- */
function buildMood(ctx) {
  const series = moodSeries(ctx.entries);
  const section = card("Mood over time", "insightMoodTitle");
  if (series.length < MOOD_SPARKLINE_MIN) {
    section.append(
      el("p", "insight-sentence quiet", `Add a mood when you save a reflection. A gentle line appears here once you have noted ${MOOD_SPARKLINE_MIN}.`)
    );
    return section;
  }

  const shown = series.slice(-SPARK_POINTS);
  const w = 300, h = 76, padX = 8, padY = 8;
  const x = (i) => (shown.length === 1 ? w / 2 : padX + ((w - padX * 2) * i) / (shown.length - 1));
  const y = (mood) => padY + ((5 - mood) / 4) * (h - padY * 2);
  const avg = moodAverage(shown);
  const latest = shown[shown.length - 1].mood;
  const summary = `${plural(shown.length, "mood")} noted, average ${avg.toFixed(1)} of 5, latest ${moodLabel(latest)}.`;

  const chart = svg("svg", { class: "mood-spark", viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": `Mood over time. ${summary}` });
  [1, 3, 5].forEach((m) => chart.append(svg("line", { class: "spark-guide", x1: padX, x2: w - padX, y1: y(m), y2: y(m) })));
  chart.append(svg("polyline", { class: "spark-line", points: shown.map((p, i) => `${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`).join(" ") }));
  shown.forEach((p, i) => chart.append(svg("circle", { class: i === shown.length - 1 ? "spark-dot latest" : "spark-dot", cx: x(i).toFixed(1), cy: y(p.mood).toFixed(1), r: i === shown.length - 1 ? 3.6 : 2.2 })));

  const frame = el("div", "spark-frame");
  const scale = el("div", "spark-scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(createMoodGlyph(5), createMoodGlyph(1));
  frame.append(scale, chart);
  section.append(frame, el("p", "insight-sentence", summary));
  return section;
}

/* ---------- on this day ---------- */
function buildOnThisDay(ctx) {
  const { entries, now, labels, onOpenMemory } = ctx;
  const section = card("On this day", "insightMemoriesTitle");
  const found = onThisDay(entries, { now });
  if (!found.length) {
    section.append(el("p", "insight-sentence quiet", "Nothing from a month or a year ago yet. Your sky is still gathering light."));
    return section;
  }

  const list = el("ul", "memory-echoes");
  found.forEach(({ label, entry }) => {
    const item = el("li", "echo");
    item.dataset.topic = entry.topic;
    const when = new Date(entry.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    item.append(el("p", "echo-kicker", `${label} · ${labels[entry.topic] || entry.topic}`), el("p", "echo-date", when));
    const excerpt = excerptFor(entry, 140);
    if (excerpt) item.append(el("p", "echo-text", excerpt));
    const open = el("button", "secondary-btn insight-action", "Open memory");
    open.type = "button";
    open.dataset.focusKey = `open-${entry.id}`;
    open.setAttribute("aria-label", `Open memory from ${when}`);
    open.addEventListener("click", () => onOpenMemory(entry.id, open));
    item.append(open);
    list.append(item);
  });
  section.append(list);
  return section;
}

/* ---------- poster ---------- */
function buildPoster(ctx, state) {
  const section = card("Atlas poster", "insightPosterTitle");
  section.append(el("p", "insight-sentence", "Save your sky as a large picture. It is made on this device and goes nowhere."));
  const btn = el("button", "secondary-btn with-icon insight-action", state.posterBusy ? "Preparing poster…" : "Download poster");
  btn.id = "downloadPosterBtn";
  btn.dataset.focusKey = "poster";
  btn.type = "button";
  btn.disabled = state.posterBusy;
  const icon = svg("svg", { "aria-hidden": "true" });
  icon.append(svg("use", { href: "#i-download" }));
  btn.prepend(icon);
  btn.addEventListener("click", ctx.exportPoster);
  section.append(btn);
  return section;
}

/* createInsightsSheet({ overlay, sheet, body, closeBtn, openBtn, getEntries, topics, labels, onOpenMemory,
 *                       onReflectTopic, onExportPoster, now? }) -> { open, close, refresh, isOpen } */
export function createInsightsSheet(options) {
  const { overlay, sheet, body, closeBtn, openBtn, getEntries, topics, labels } = options;
  const state = { posterBusy: false, open: false };

  const context = () => ({
    entries: getEntries(),
    topics,
    labels,
    now: options.now ? options.now() : new Date(),
    onOpenMemory: options.onOpenMemory,
    onReflectTopic: (topic) => {
      close({ restoreFocus: false });
      options.onReflectTopic(topic);
    },
    exportPoster: async () => {
      if (state.posterBusy) return;
      state.posterBusy = true;
      render();
      try {
        await options.onExportPoster();
      } finally {
        state.posterBusy = false;
        render();
        body.querySelector("#downloadPosterBtn")?.focus({ preventScroll: true });
      }
    },
  });

  // Rebuilding the body must not drop keyboard focus: put it back on the same control.
  function render() {
    if (!state.open) return;
    const focusKey = document.activeElement?.dataset?.focusKey;
    const ctx = context();
    const scrollTop = body.scrollTop;
    body.replaceChildren(buildBalance(ctx), buildCalendar(ctx), buildMood(ctx), buildOnThisDay(ctx), buildPoster(ctx, state));
    body.scrollTop = scrollTop;
    if (focusKey) body.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  function open() {
    state.open = true;
    render();
    openDialog({ overlay, panel: sheet, returnFocus: openBtn, initialFocus: closeBtn, onRequestClose: () => close() });
    body.scrollTop = 0;
  }

  function close({ restoreFocus = true } = {}) {
    state.open = false;
    closeDialog(overlay, { restoreFocus });
  }

  closeBtn.addEventListener("click", () => close());
  openBtn.addEventListener("click", open);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  return { open, close, refresh: () => render(), isOpen: () => state.open };
}
