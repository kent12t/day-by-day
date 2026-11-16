// Pure helpers for the Memories view (issue #5): filtering, search and
// month grouping. No DOM access here so these stay easy to test.

export const MEMORY_PAGE_SIZE = 20;

export function normalizeSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterMemories(entries, { topic = "all", query = "" } = {}) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);

  return entries.filter((entry) => {
    if (topic !== "all" && entry.topic !== topic) return false;
    if (!terms.length) return true;
    const haystack = normalizeSearchText(`${entry.promptText || ""} ${entry.followUp || ""} ${entry.text || ""}`);
    return terms.every((term) => haystack.includes(term));
  });
}

// Newest first.
export function sortMemoriesNewestFirst(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function monthKeyFor(dateValue) {
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Groups an already-sorted list into [{ key, label, entries }] preserving order.
export function groupMemoriesByMonth(entries) {
  const groups = [];
  let current = null;

  entries.forEach((entry) => {
    const key = monthKeyFor(entry.date);
    if (!current || current.key !== key) {
      current = { key, label: formatMonthLabel(key), entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  });

  return groups;
}

export function excerptFor(entry, maxLength = 120) {
  const source = (entry.text || "").trim() || (entry.promptText || "").trim();
  const flat = source.replace(/\s+/g, " ");
  if (flat.length <= maxLength) return flat;
  return `${flat.slice(0, maxLength - 1).trimEnd()}…`;
}
