// Pure, local-only computations behind the Insights sheet (issue #11).
// No DOM and no network. Every function takes `now` explicitly so tests can
// pin the date; days are always the user's local calendar days.
import { localDayKey } from "./prompt-logic.js";

export const MOOD_LEVELS = [
  { value: 1, label: "Very low" },
  { value: 2, label: "Low" },
  { value: 3, label: "Even" },
  { value: 4, label: "Bright" },
  { value: 5, label: "Glowing" },
];

export const MOOD_SPARKLINE_MIN = 5;

// An optional mood is an integer 1-5; anything else means "no mood".
export function normalizeMood(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export function moodLabel(value) {
  const mood = normalizeMood(value);
  return mood ? MOOD_LEVELS[mood - 1].label : "";
}

// Local midnight of the given date, shifted by `days` calendar days (DST-safe).
export function addDays(dateValue, days) {
  const d = new Date(dateValue);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

// Calendar-day difference a - b (local), ignoring time of day and DST.
export function dayDiff(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ua - ub) / 86400000);
}

// Same day-of-month `months` earlier, clamped to the end of shorter months.
export function addMonths(dateValue, months) {
  const d = new Date(dateValue);
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay));
}

// Entries in the last `days` local days (today included).
export function entriesInWindow(entries, { now = new Date(), days = 30 } = {}) {
  return entries.filter((entry) => {
    const age = dayDiff(now, entry.date);
    return age >= 0 && age < days;
  });
}

// { counts: { topic: n }, total } for the last `days` days; every topic in
// `topics` is present (zero when unused). Entries on other topics are ignored.
export function topicCountsInWindow(entries, topics, { now = new Date(), days = 30 } = {}) {
  const counts = Object.fromEntries(topics.map((topic) => [topic, 0]));
  let total = 0;
  entriesInWindow(entries, { now, days }).forEach((entry) => {
    if (Object.prototype.hasOwnProperty.call(counts, entry.topic)) {
      counts[entry.topic] += 1;
      total += 1;
    }
  });
  return { counts, total };
}

// Whole days since the topic was last written about, or null if never.
export function daysSinceTopic(entries, topic, now = new Date()) {
  let best = null;
  entries.forEach((entry) => {
    if (entry.topic !== topic) return;
    const age = dayDiff(now, entry.date);
    if (age < 0) return;
    if (best === null || age < best) best = age;
  });
  return best;
}

// The topic you have been away from longest (never visited counts as longest;
// ties go to the earliest topic in `topics`). Null when there are no entries at all.
export function leastVisitedTopic(entries, topics, now = new Date()) {
  if (!entries.length || !topics.length) return null;
  let pick = null;
  topics.forEach((topic) => {
    const days = daysSinceTopic(entries, topic, now);
    const score = days === null ? Infinity : days;
    if (!pick || score > pick.score) pick = { topic, daysSince: days, score };
  });
  return { topic: pick.topic, daysSince: pick.daysSince };
}

// "You haven't visited Body in 3 weeks". Null when the gap is under a week
// (nothing worth pointing out). Gentle wording, no pressure.
export function absenceSentence(label, daysSince) {
  if (daysSince === null) return `You haven't visited ${label} yet.`;
  if (daysSince < 7) return null;
  if (daysSince < 14) return `You haven't visited ${label} in ${daysSince} days.`;
  if (daysSince < 60) return `You haven't visited ${label} in ${Math.floor(daysSince / 7)} weeks.`;
  return `You haven't visited ${label} in ${Math.floor(daysSince / 30)} months.`;
}

// Calendar heatmap: `weeks` columns (oldest first), each 7 cells Monday..Sunday.
// The last column is the week containing today; cells after today are `future`.
export function buildHeatmap(entries, { now = new Date(), weeks = 12 } = {}) {
  const perDay = new Map();
  entries.forEach((entry) => {
    const key = localDayKey(entry.date);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  });

  const today = addDays(now, 0);
  const mondayOffset = (today.getDay() + 6) % 7; // Mon = 0 ... Sun = 6
  const start = addDays(today, -mondayOffset - (weeks - 1) * 7);
  const todayKey = localDayKey(today);
  const grid = [];
  let nights = 0;

  for (let w = 0; w < weeks; w += 1) {
    const column = [];
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(start, w * 7 + d);
      const key = localDayKey(date);
      const future = date.getTime() > today.getTime();
      const count = future ? 0 : perDay.get(key) || 0;
      if (count) nights += 1;
      column.push({ key, date, count, future, today: key === todayKey });
    }
    grid.push(column);
  }

  return { weeks: grid, nights };
}

// Distinct local days with at least one reflection in the month of `now`.
export function nightsInMonth(entries, now = new Date()) {
  const ref = new Date(now);
  const days = new Set();
  entries.forEach((entry) => {
    const d = new Date(entry.date);
    if (d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()) days.add(localDayKey(d));
  });
  return days.size;
}

// Gentle resurfacing: the entry nearest to one month ago and to one year ago
// (within +/- `slack` days of the target date). Returns [{ kind, label, entry }].
export function onThisDay(entries, { now = new Date(), slack = 1 } = {}) {
  const targets = [
    { kind: "month", label: "A month ago", date: addMonths(now, -1) },
    { kind: "year", label: "A year ago", date: addMonths(now, -12) },
  ];
  const found = [];
  targets.forEach((target) => {
    let best = null;
    entries.forEach((entry) => {
      const off = Math.abs(dayDiff(entry.date, target.date));
      if (off > slack) return;
      const newer = best && new Date(entry.date).getTime() > new Date(best.entry.date).getTime();
      if (!best || off < best.off || (off === best.off && newer)) best = { entry, off };
    });
    if (best) found.push({ kind: target.kind, label: target.label, entry: best.entry });
  });
  return found;
}

// Oldest-first [{ id, date, mood }] for entries that carry a mood.
export function moodSeries(entries) {
  return entries
    .map((entry) => ({ id: entry.id, date: entry.date, mood: normalizeMood(entry.mood) }))
    .filter((point) => point.mood !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function moodAverage(series) {
  if (!series.length) return 0;
  return series.reduce((sum, point) => sum + point.mood, 0) / series.length;
}
