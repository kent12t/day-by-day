import { describe, expect, it } from "vitest";
import {
  DEPTHS,
  MAX_STARS_PER_DEVICE_PER_DAY,
  TOPICS,
  TOPIC_CENTERS,
  dayDifference,
  isDeviceId,
  isOverRateLimit,
  isValidDayKey,
  retentionCutoffDay,
  sharedStarPlacement,
  toPublicStar,
  validateStar,
} from "../../shared/star-rules.js";

const DEVICE = "123e4567-e89b-42d3-a456-426614174000";
const good = { deviceId: DEVICE, topic: "dreams", depth: "bold", day: "2026-11-16", seed: 12345 };

describe("validateStar", () => {
  it("accepts a well-formed star", () => {
    expect(validateStar(good, "2026-11-16")).toEqual({ ok: true });
  });

  it("accepts every topic and depth", () => {
    for (const topic of TOPICS)
      for (const depth of DEPTHS) expect(validateStar({ ...good, topic, depth }, "2026-11-16").ok).toBe(true);
  });

  it("rejects unknown enums, including wildcard", () => {
    expect(validateStar({ ...good, topic: "wildcard" }, "2026-11-16").code).toBe("invalid_topic");
    expect(validateStar({ ...good, topic: "<script>" }, "2026-11-16").code).toBe("invalid_topic");
    expect(validateStar({ ...good, depth: "abyssal" }, "2026-11-16").code).toBe("invalid_depth");
  });

  it("rejects bad device ids and seeds", () => {
    expect(validateStar({ ...good, deviceId: "me@example.com" }, "2026-11-16").code).toBe("invalid_device");
    expect(validateStar({ ...good, seed: 1.5 }, "2026-11-16").code).toBe("invalid_seed");
    expect(validateStar({ ...good, seed: -1 }, "2026-11-16").code).toBe("invalid_seed");
    expect(validateStar({ ...good, seed: 2 ** 31 }, "2026-11-16").code).toBe("invalid_seed");
  });

  it("rejects any extra (potentially personal) field", () => {
    for (const extra of ["text", "entryId", "promptText", "photo", "date"]) {
      const verdict = validateStar({ ...good, [extra]: "x" }, "2026-11-16");
      expect(verdict.ok).toBe(false);
      expect(verdict.message).toContain(extra);
    }
  });

  it("allows one day of clock/time-zone drift and no more", () => {
    expect(validateStar({ ...good, day: "2026-11-15" }, "2026-11-16").ok).toBe(true);
    expect(validateStar({ ...good, day: "2026-11-17" }, "2026-11-16").ok).toBe(true);
    expect(validateStar({ ...good, day: "2026-11-14" }, "2026-11-16").code).toBe("day_out_of_range");
    expect(validateStar({ ...good, day: "2026-11-18" }, "2026-11-16").code).toBe("day_out_of_range");
  });
});

describe("day helpers", () => {
  it("validates real calendar days only", () => {
    expect(isValidDayKey("2026-11-16")).toBe(true);
    expect(isValidDayKey("2028-02-29")).toBe(true);
    expect(isValidDayKey("2026-02-29")).toBe(false);
    expect(isValidDayKey("2026-13-01")).toBe(false);
    expect(isValidDayKey("2026-1-1")).toBe(false);
    expect(isValidDayKey("2026-11-16T10:00:00Z")).toBe(false);
    expect(isValidDayKey(20261116)).toBe(false);
  });

  it("counts days across month and year boundaries", () => {
    expect(dayDifference("2026-12-31", "2027-01-01")).toBe(1);
    expect(dayDifference("2026-03-01", "2026-02-28")).toBe(-1);
  });

  it("computes the retention cutoff", () => {
    expect(retentionCutoffDay("2026-11-16", 3)).toBe("2026-11-13");
    expect(retentionCutoffDay("2026-01-02", 3)).toBe("2025-12-30");
  });

  it("only accepts uuid-shaped device ids", () => {
    expect(isDeviceId(DEVICE)).toBe(true);
    expect(isDeviceId("nope")).toBe(false);
    expect(isDeviceId(DEVICE.toUpperCase())).toBe(false);
  });
});

describe("rate limit", () => {
  it("allows up to the limit per device per day", () => {
    expect(MAX_STARS_PER_DEVICE_PER_DAY).toBe(10);
    expect(isOverRateLimit(0)).toBe(false);
    expect(isOverRateLimit(9)).toBe(false);
    expect(isOverRateLimit(10)).toBe(true);
    expect(isOverRateLimit(11)).toBe(true);
  });
});

describe("toPublicStar", () => {
  it("returns only topic, depth and seed", () => {
    const row = {
      _id: "abc",
      _creationTime: 1,
      deviceId: DEVICE,
      topic: "self",
      depth: "gentle",
      day: "2026-11-16",
      seed: 7,
    };
    const projected = toPublicStar(row);
    expect(projected).toEqual({ topic: "self", depth: "gentle", seed: 7 });
    expect(JSON.stringify(projected)).not.toContain(DEVICE);
    expect(Object.keys(projected).sort()).toEqual(["depth", "seed", "topic"]);
  });
});

describe("sharedStarPlacement", () => {
  const world = { width: 1600, height: 900 };

  it("is deterministic from seed and topic", () => {
    const a = sharedStarPlacement({ topic: "nature", seed: 99 }, world);
    expect(sharedStarPlacement({ topic: "nature", seed: 99 }, world)).toEqual(a);
    expect(sharedStarPlacement({ topic: "nature", seed: 100 }, world)).not.toEqual(a);
    expect(sharedStarPlacement({ topic: "body", seed: 99 }, world)).not.toEqual(a);
  });

  it("stays inside the world and clusters around the topic centre", () => {
    let sumX = 0;
    let sumY = 0;
    const n = 400;
    for (let seed = 0; seed < n; seed += 1) {
      const { x, y, size } = sharedStarPlacement({ topic: "dreams", seed: seed * 7919 }, world);
      expect(x).toBeGreaterThanOrEqual(16);
      expect(x).toBeLessThanOrEqual(world.width - 16);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y).toBeLessThanOrEqual(world.height - 16);
      expect(size).toBeGreaterThan(0.8);
      expect(size).toBeLessThan(2.1);
      sumX += x;
      sumY += y;
    }
    const [cx, cy] = TOPIC_CENTERS.dreams;
    expect(Math.abs(sumX / n - cx * world.width)).toBeLessThan(60);
    expect(Math.abs(sumY / n - cy * world.height)).toBeLessThan(40);
  });
});
