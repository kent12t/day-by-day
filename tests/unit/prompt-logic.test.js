import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chooseLeastUsedTopic,
  countEntriesOnDay,
  customPromptId,
  hashString,
  localDayKey,
  mixHash,
  pickRankedPrompt,
} from "../../lib/prompt-logic.js";
import { PROMPT_TOPICS } from "../../scripts/check-prompts.mjs";

const TOPICS = PROMPT_TOPICS;

// Node re-reads process.env.TZ on change, so a test can pin a zone.
function withTimeZone(zone) {
  let previous;
  beforeEach(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}

function makePool(count, prefix = "p") {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i + 1}`, text: `Prompt ${i + 1}` }));
}

describe("hashString / mixHash", () => {
  it("is deterministic and 32-bit", () => {
    expect(hashString("day-by-day")).toBe(hashString("day-by-day"));
    expect(hashString("")).toBe(0);
    expect(Number.isInteger(hashString("x".repeat(500)))).toBe(true);
    expect(Math.abs(hashString("x".repeat(500)))).toBeLessThan(2 ** 31 + 1);
  });

  it("mixHash returns an unsigned 32-bit integer and spreads neighbours", () => {
    const a = mixHash(hashString("self-gentle-1"));
    const b = mixHash(hashString("self-gentle-2"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
    expect(Math.abs(a - b)).toBeGreaterThan(1000);
  });
});

describe("localDayKey", () => {
  describe("in America/Los_Angeles (UTC-8 in winter)", () => {
    withTimeZone("America/Los_Angeles");

    it("uses the local date, not the UTC date, late in the evening", () => {
      // 2026-01-15 23:30 local is already 2026-01-16 in UTC.
      const lateEvening = new Date("2026-01-16T07:30:00Z");
      expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-01-16");
      expect(localDayKey(lateEvening)).toBe("2026-01-15");
    });

    it("rolls over at local midnight", () => {
      expect(localDayKey(new Date("2026-01-16T07:59:59Z"))).toBe("2026-01-15");
      expect(localDayKey(new Date("2026-01-16T08:00:00Z"))).toBe("2026-01-16");
    });

    it("accepts ISO strings and timestamps", () => {
      expect(localDayKey("2026-01-16T07:30:00Z")).toBe("2026-01-15");
      expect(localDayKey(Date.parse("2026-01-16T07:30:00Z"))).toBe("2026-01-15");
    });
  });

  describe("in Asia/Tokyo (UTC+9)", () => {
    withTimeZone("Asia/Tokyo");

    it("uses the local date early in the morning", () => {
      // 2026-03-01 08:00 local is still 2026-02-28 in UTC.
      expect(localDayKey(new Date("2026-02-28T23:00:00Z"))).toBe("2026-03-01");
    });

    it("pads month and day", () => {
      expect(localDayKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
    });
  });

  it("defaults to now", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(localDayKey()).toBe(expected);
  });
});

describe("countEntriesOnDay", () => {
  withTimeZone("America/Los_Angeles");

  it("counts entries by their local day", () => {
    const entries = [
      { date: "2026-01-16T07:30:00Z" }, // 15th local
      { date: "2026-01-16T09:00:00Z" }, // 16th local
      { date: "2026-01-15T20:00:00Z" }, // 15th local
    ];
    expect(countEntriesOnDay(entries, "2026-01-15")).toBe(2);
    expect(countEntriesOnDay(entries, "2026-01-16")).toBe(1);
    expect(countEntriesOnDay([], "2026-01-16")).toBe(0);
  });
});

describe("chooseLeastUsedTopic", () => {
  it("picks the only unused topic", () => {
    const entries = TOPICS.filter((t) => t !== "dreams").map((topic) => ({ topic }));
    expect(chooseLeastUsedTopic(entries, TOPICS, "seed")).toBe("dreams");
  });

  it("can land on every one of the 10 topics", () => {
    for (const target of TOPICS) {
      const entries = TOPICS.filter((t) => t !== target).map((topic) => ({ topic }));
      expect(chooseLeastUsedTopic(entries, TOPICS, "any")).toBe(target);
    }
  });

  it("ignores topics outside the candidate list (e.g. wildcard)", () => {
    const entries = [...TOPICS.map((topic) => ({ topic })), { topic: "wildcard" }, { topic: "wildcard" }];
    const picked = chooseLeastUsedTopic(entries, TOPICS, "x");
    expect(TOPICS).toContain(picked);
  });

  it("breaks ties deterministically by seed and spreads across all topics", () => {
    expect(chooseLeastUsedTopic([], TOPICS, "2026-01-01-0")).toBe(chooseLeastUsedTopic([], TOPICS, "2026-01-01-0"));

    const seen = new Set();
    for (let day = 1; day <= 200; day += 1) seen.add(chooseLeastUsedTopic([], TOPICS, `seed-${day}`));
    expect([...seen].sort()).toEqual([...TOPICS].sort());
  });

  it("only picks among the least-used topics", () => {
    const entries = [{ topic: "self" }, { topic: "self" }, { topic: "work" }];
    for (let i = 0; i < 50; i += 1) {
      const picked = chooseLeastUsedTopic(entries, TOPICS, `s${i}`);
      expect(["self", "work"]).not.toContain(picked);
    }
  });
});

describe("pickRankedPrompt", () => {
  const pool = makePool(20);

  it("returns null for an empty pool", () => {
    expect(pickRankedPrompt([], "seed")).toBeNull();
  });

  it("is deterministic for the same seed", () => {
    const a = pickRankedPrompt(pool, "2026-01-15-self-gentle-0");
    const b = pickRankedPrompt([...pool].reverse(), "2026-01-15-self-gentle-0");
    expect(a).toBe(b);
  });

  it("varies with the seed", () => {
    const picks = new Set();
    for (let day = 1; day <= 28; day += 1) picks.add(pickRankedPrompt(pool, `2026-02-${day}-self-gentle-0`).id);
    expect(picks.size).toBeGreaterThan(5);
  });

  it("does not repeat recently used prompts while fresh ones remain", () => {
    const seed = "2026-01-15-work-bold-0";
    const recent = new Set(pool.slice(0, 19).map((p) => p.id));
    expect(pickRankedPrompt(pool, seed, recent).id).toBe("p-20");

    for (let offset = 0; offset < 5; offset += 1) {
      expect(recent.has(pickRankedPrompt(pool, seed, new Set(recent), offset).id)).toBe(false);
    }
  });

  it("falls back to the full pool once everything was used recently", () => {
    const recent = new Set(pool.map((p) => p.id));
    expect(pickRankedPrompt(pool, "seed", recent)).toBe(pickRankedPrompt(pool, "seed"));
  });

  it("moves to a different prompt for each offset and wraps around", () => {
    const seed = "2026-01-15-dreams-ethereal-0";
    const ids = Array.from({ length: pool.length }, (_, i) => pickRankedPrompt(pool, seed, new Set(), i).id);
    expect(new Set(ids).size).toBe(pool.length);
    expect(pickRankedPrompt(pool, seed, new Set(), pool.length)).toBe(pickRankedPrompt(pool, seed, new Set(), 0));
    expect(pickRankedPrompt(pool, seed, new Set(), -1)).toBe(pickRankedPrompt(pool, seed, new Set(), pool.length - 1));
  });

  it("keeps the choice stable when lower-ranked prompts enter or leave recent history", () => {
    const seed = "2026-01-15-self-deeper-1";
    const ranked = Array.from({ length: pool.length }, (_, i) => pickRankedPrompt(pool, seed, new Set(), i));
    const chosen = ranked[0];
    expect(pickRankedPrompt(pool, seed, new Set([ranked[5].id, ranked[12].id]))).toBe(chosen);
    expect(pickRankedPrompt(pool, seed, new Set([ranked[12].id]))).toBe(chosen);
    // and a pool that only lost an unrelated prompt ranks the rest the same way
    const smaller = pool.filter((p) => p.id !== ranked[7].id);
    expect(pickRankedPrompt(smaller, seed)).toBe(chosen);
  });

  it("does not mutate the pool", () => {
    const copy = [...pool];
    pickRankedPrompt(pool, "seed", new Set(), 3);
    expect(pool).toEqual(copy);
  });
});

describe("customPromptId", () => {
  it("is stable for the same text and ignores surrounding whitespace", () => {
    const id = customPromptId("What did I notice today?");
    expect(id).toBe(customPromptId("What did I notice today?"));
    expect(id).toBe(customPromptId("  What did I notice today?\n"));
    expect(id).toMatch(/^custom-[0-9a-z]+$/);
  });

  it("differs for different text", () => {
    expect(customPromptId("one")).not.toBe(customPromptId("two"));
  });

  it("has a known value so stored ids never silently change", () => {
    expect(customPromptId("hello")).toBe(`custom-${(hashString("hello") >>> 0).toString(36)}`);
    expect(customPromptId("hello")).toBe("custom-1n1e4y");
  });
});
