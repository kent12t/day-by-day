import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_PAGE_SIZE,
  excerptFor,
  filterMemories,
  formatMonthLabel,
  groupMemoriesByMonth,
  monthKeyFor,
  normalizeSearchText,
  sortMemoriesNewestFirst,
} from "../../lib/memories.js";

const ENTRIES = [
  {
    id: "a",
    date: "2026-01-03T10:00:00.000Z",
    topic: "self",
    promptText: "What feeling visited me today?",
    followUp: "Where did I notice it?",
    text: "Mostly calm, a little restless after lunch.",
  },
  {
    id: "b",
    date: "2026-01-20T18:00:00.000Z",
    topic: "nature",
    promptText: "What did the sky look like?",
    followUp: "",
    text: "A café window full of rain.",
  },
  {
    id: "c",
    date: "2026-02-02T09:00:00.000Z",
    topic: "self",
    promptText: "What am I carrying?",
    followUp: "Can I set it down?",
    text: "",
  },
  {
    id: "d",
    date: "2025-12-31T12:00:00.000Z",
    topic: "work",
    promptText: "What did I finish?",
    followUp: "",
  },
];

describe("normalizeSearchText", () => {
  it("lowercases, strips accents and collapses whitespace", () => {
    expect(normalizeSearchText("  CAFÉ\n  Crème   ")).toBe("cafe creme");
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("filterMemories", () => {
  it("returns everything by default", () => {
    expect(filterMemories(ENTRIES)).toHaveLength(4);
    expect(filterMemories(ENTRIES, { topic: "all", query: "   " })).toHaveLength(4);
  });

  it("filters by topic", () => {
    expect(filterMemories(ENTRIES, { topic: "self" }).map((e) => e.id)).toEqual(["a", "c"]);
    expect(filterMemories(ENTRIES, { topic: "dreams" })).toEqual([]);
  });

  it("searches prompt, follow-up and note text, case and accent insensitively", () => {
    expect(filterMemories(ENTRIES, { query: "RESTLESS" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterMemories(ENTRIES, { query: "cafe" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterMemories(ENTRIES, { query: "set it down" }).map((e) => e.id)).toEqual(["c"]);
    expect(filterMemories(ENTRIES, { query: "sky" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("requires every search term to match", () => {
    expect(filterMemories(ENTRIES, { query: "calm lunch" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterMemories(ENTRIES, { query: "calm rain" })).toEqual([]);
  });

  it("combines topic and search", () => {
    expect(filterMemories(ENTRIES, { topic: "self", query: "carrying" }).map((e) => e.id)).toEqual(["c"]);
    expect(filterMemories(ENTRIES, { topic: "nature", query: "carrying" })).toEqual([]);
  });

  it("tolerates entries with missing text fields", () => {
    expect(filterMemories([{ id: "x", date: "2026-01-01T00:00:00Z", topic: "self" }], { query: "x" })).toEqual([]);
  });
});

describe("sortMemoriesNewestFirst", () => {
  it("sorts by ISO date descending without mutating the input", () => {
    const input = [...ENTRIES];
    expect(sortMemoriesNewestFirst(input).map((e) => e.id)).toEqual(["c", "b", "a", "d"]);
    expect(input.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("month grouping", () => {
  let previousTz;
  beforeEach(() => {
    previousTz = process.env.TZ;
    process.env.TZ = "UTC";
  });
  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it("builds YYYY-MM keys", () => {
    expect(monthKeyFor("2026-01-03T10:00:00.000Z")).toBe("2026-01");
    expect(monthKeyFor("2025-12-31T12:00:00.000Z")).toBe("2025-12");
  });

  it("formats a readable month label", () => {
    const label = formatMonthLabel("2026-02");
    expect(label).toMatch(/2026/);
    expect(label).toBe(new Date(2026, 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  });

  it("groups a sorted list by month, preserving order", () => {
    const groups = groupMemoriesByMonth(sortMemoriesNewestFirst(ENTRIES));
    expect(groups.map((g) => g.key)).toEqual(["2026-02", "2026-01", "2025-12"]);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([["c"], ["b", "a"], ["d"]]);
    groups.forEach((g) => expect(typeof g.label).toBe("string"));
  });

  it("returns no groups for no entries", () => {
    expect(groupMemoriesByMonth([])).toEqual([]);
  });
});

describe("excerptFor", () => {
  it("prefers the note and flattens whitespace", () => {
    expect(excerptFor({ text: "  line one\n\nline two  ", promptText: "prompt" })).toBe("line one line two");
  });

  it("falls back to the prompt text", () => {
    expect(excerptFor({ text: "   ", promptText: "What am I carrying?" })).toBe("What am I carrying?");
    expect(excerptFor({})).toBe("");
  });

  it("truncates long text with an ellipsis within the limit", () => {
    const text = "word ".repeat(60);
    const excerpt = excerptFor({ text }, 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toMatch(/\s…$/);
    expect(excerptFor({ text: "x".repeat(120) })).toHaveLength(120);
    expect(excerptFor({ text: "x".repeat(121) })).toHaveLength(120);
  });
});

describe("MEMORY_PAGE_SIZE", () => {
  it("is a positive page size", () => {
    expect(MEMORY_PAGE_SIZE).toBeGreaterThan(0);
  });
});
