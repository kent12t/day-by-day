import { describe, expect, it } from "vitest";
import {
  absenceSentence,
  addMonths,
  buildHeatmap,
  daysSinceTopic,
  dayDiff,
  leastVisitedTopic,
  moodAverage,
  moodLabel,
  moodSeries,
  nightsInMonth,
  normalizeMood,
  onThisDay,
  topicCountsInWindow,
} from "../../lib/insights.js";


// Local noon on a given day, as the ISO string entries store.
// Fixed zone so "local day" is deterministic wherever the tests run. Imports are hoisted, but nothing in
// lib/insights.js reads the zone until a function is called, and this runs before any describe block.
process.env.TZ = "America/New_York";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const entry = (id, topic, date, extra = {}) => ({ id, topic, date, ...extra });

// "Today" is Wed 2026-06-17 (local).
const NOW = new Date(2026, 5, 17, 21, 30);
const TOPICS = ["self", "body", "work", "nature"];

describe("normalizeMood", () => {
  it("accepts integers 1-5 and numeric strings", () => {
    expect(normalizeMood(1)).toBe(1);
    expect(normalizeMood(5)).toBe(5);
    expect(normalizeMood("3")).toBe(3);
  });

  it("drops everything else", () => {
    [0, 6, 2.5, "", "x", null, undefined, NaN, {}, [], true].forEach((v) => expect(normalizeMood(v)).toBeNull());
  });

  it("labels moods", () => {
    expect(moodLabel(5)).toBe("Glowing");
    expect(moodLabel(undefined)).toBe("");
  });
});

describe("date helpers", () => {
  it("counts calendar days across DST changes", () => {
    expect(dayDiff(new Date(2026, 2, 9), new Date(2026, 2, 8))).toBe(1);
    expect(dayDiff(new Date(2026, 10, 2, 23, 59), new Date(2026, 10, 1, 0, 1))).toBe(1);
  });

  it("clamps addMonths to shorter months", () => {
    expect(addMonths(new Date(2026, 2, 31), -1).getDate()).toBe(28);
    expect(addMonths(new Date(2024, 1, 29), -12).getDate()).toBe(28);
    expect(addMonths(new Date(2026, 0, 15), -1).getMonth()).toBe(11);
  });
});

describe("topicCountsInWindow", () => {
  const entries = [
    entry("a", "self", at(2026, 6, 17)),
    entry("b", "self", at(2026, 6, 1)),
    entry("c", "body", at(2026, 5, 19)), // 29 days ago: inside
    entry("d", "body", at(2026, 5, 18)), // 30 days ago: outside
    entry("e", "work", at(2026, 6, 18)), // future: ignored
    entry("f", "legacy", at(2026, 6, 10)), // topic not in list: ignored
  ];

  it("counts the last 30 local days, zero-filling unused topics", () => {
    const { counts, total } = topicCountsInWindow(entries, TOPICS, { now: NOW });
    expect(counts).toEqual({ self: 2, body: 1, work: 0, nature: 0 });
    expect(total).toBe(3);
  });

  it("supports a different window", () => {
    expect(topicCountsInWindow(entries, TOPICS, { now: NOW, days: 7 }).total).toBe(1);
  });
});

describe("least visited topic", () => {
  const entries = [
    entry("a", "self", at(2026, 6, 16)),
    entry("b", "body", at(2026, 5, 27)), // 21 days
    entry("c", "work", at(2026, 6, 10)),
    entry("d", "nature", at(2026, 6, 1)),
  ];

  it("measures days since a topic was last visited", () => {
    expect(daysSinceTopic(entries, "body", NOW)).toBe(21);
    expect(daysSinceTopic(entries, "self", NOW)).toBe(1);
    expect(daysSinceTopic(entries, "dreams", NOW)).toBeNull();
  });

  it("picks the topic you have been away from longest", () => {
    expect(leastVisitedTopic(entries, TOPICS, NOW)).toEqual({ topic: "body", daysSince: 21 });
  });

  it("treats a never-visited topic as the longest gap, ties by topic order", () => {
    const result = leastVisitedTopic(entries, [...TOPICS, "dreams", "spirit"], NOW);
    expect(result).toEqual({ topic: "dreams", daysSince: null });
  });

  it("is null without entries", () => {
    expect(leastVisitedTopic([], TOPICS, NOW)).toBeNull();
  });

  it("words the gap gently", () => {
    expect(absenceSentence("Body", 21)).toBe("You haven't visited Body in 3 weeks.");
    expect(absenceSentence("Body", 9)).toBe("You haven't visited Body in 9 days.");
    expect(absenceSentence("Body", 90)).toBe("You haven't visited Body in 3 months.");
    expect(absenceSentence("Body", null)).toBe("You haven't visited Body yet.");
    expect(absenceSentence("Body", 3)).toBeNull();
  });
});

describe("buildHeatmap", () => {
  const entries = [
    entry("a", "self", at(2026, 6, 17)),
    entry("b", "self", at(2026, 6, 17, 8)), // same day twice
    entry("c", "body", at(2026, 6, 15)), // Monday
    entry("d", "body", at(2026, 3, 30)), // Monday of the first column (12 weeks back)
    entry("e", "body", at(2026, 3, 29)), // Sunday before the grid: outside
  ];
  const heat = buildHeatmap(entries, { now: NOW, weeks: 12 });

  it("lays out 12 columns of 7 days, Monday first, ending this week", () => {
    expect(heat.weeks).toHaveLength(12);
    heat.weeks.forEach((week) => expect(week).toHaveLength(7));
    expect(heat.weeks[0][0].key).toBe("2026-03-30");
    expect(heat.weeks[0][0].date.getDay()).toBe(1);
    expect(heat.weeks[11][0].key).toBe("2026-06-15");
    expect(heat.weeks[11][6].key).toBe("2026-06-21");
  });

  it("marks today, future days and counts per day", () => {
    const last = heat.weeks[11];
    expect(last[2]).toMatchObject({ key: "2026-06-17", count: 2, today: true, future: false });
    expect(last[0]).toMatchObject({ count: 1, today: false });
    expect(last[3]).toMatchObject({ future: true, count: 0 });
    expect(heat.weeks[0][0].count).toBe(1);
  });

  it("counts nights reflected inside the grid", () => {
    expect(heat.nights).toBe(3);
  });
});

describe("nightsInMonth", () => {
  it("counts distinct days in the current month only", () => {
    const entries = [
      entry("a", "self", at(2026, 6, 17)),
      entry("b", "self", at(2026, 6, 17, 7)),
      entry("c", "self", at(2026, 6, 2)),
      entry("d", "self", at(2026, 5, 30)),
      entry("e", "self", at(2025, 6, 9)),
    ];
    expect(nightsInMonth(entries, NOW)).toBe(2);
    expect(nightsInMonth([], NOW)).toBe(0);
  });
});

describe("onThisDay", () => {
  it("finds an entry near one month and one year ago", () => {
    const entries = [
      entry("m", "self", at(2026, 5, 17)),
      entry("y", "body", at(2025, 6, 18)), // a day off still counts
      entry("far", "work", at(2026, 5, 3)),
    ];
    const found = onThisDay(entries, { now: NOW });
    expect(found.map((f) => [f.kind, f.entry.id])).toEqual([
      ["month", "m"],
      ["year", "y"],
    ]);
    expect(found[0].label).toBe("A month ago");
  });

  it("prefers the closest day and returns nothing when there is no match", () => {
    const entries = [entry("near", "self", at(2026, 5, 17)), entry("off", "self", at(2026, 5, 16))];
    expect(onThisDay(entries, { now: NOW })[0].entry.id).toBe("near");
    expect(onThisDay([entry("x", "self", at(2026, 6, 1))], { now: NOW })).toEqual([]);
  });

  it("clamps month ends (31 Mar looks back to 28 Feb)", () => {
    const found = onThisDay([entry("feb", "self", at(2026, 2, 28))], { now: new Date(2026, 2, 31, 10) });
    expect(found[0].entry.id).toBe("feb");
  });
});

describe("moodSeries", () => {
  const entries = [
    entry("c", "self", at(2026, 6, 3), { mood: 4 }),
    entry("a", "self", at(2026, 6, 1), { mood: 2 }),
    entry("b", "self", at(2026, 6, 2)),
    entry("d", "self", at(2026, 6, 4), { mood: 9 }),
    entry("e", "self", at(2026, 6, 5), { mood: "5" }),
  ];

  it("keeps valid moods oldest first", () => {
    expect(moodSeries(entries).map((p) => [p.id, p.mood])).toEqual([
      ["a", 2],
      ["c", 4],
      ["e", 5],
    ]);
  });

  it("averages", () => {
    expect(moodAverage(moodSeries(entries))).toBeCloseTo(11 / 3);
    expect(moodAverage([])).toBe(0);
  });
});
