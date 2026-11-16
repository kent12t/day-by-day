import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSharedSky, publishedKey } from "../../shared/shared-sky.js";
import { isDeviceId, validateStar } from "../../shared/star-rules.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

// A fake Convex client: records mutations, lets tests push query updates, can go "offline".
function fakeClient() {
  const calls = [];
  const subs = [];
  const client = {
    offline: false,
    rejectWith: null,
    closed: false,
    calls,
    subs,
    mutation: vi.fn(async (ref, args) => {
      if (client.offline) throw new Error("network down");
      if (client.rejectWith) throw Object.assign(new Error("rejected"), { data: { code: client.rejectWith } });
      calls.push({ ref, args });
      return ref === "stars:withdraw" ? { removed: 3 } : { ok: true };
    }),
    onUpdate: vi.fn((ref, args, cb) => {
      subs.push({ ref, args, cb });
      return () => {
        subs.splice(
          subs.findIndex((s) => s.cb === cb),
          1
        );
      };
    }),
    close: vi.fn(() => {
      client.closed = true;
    }),
  };
  const api = {
    stars: {
      today: "stars:today",
      countToday: "stars:countToday",
      publish: "stars:publish",
      withdraw: "stars:withdraw",
    },
  };
  return { client, api };
}

const NOW = new Date(2026, 10, 16, 21, 30, 0); // local time, 16 Nov 2026
const entry = (id, extra = {}) => ({
  id,
  date: NOW.toISOString(),
  topic: "gratitude",
  depth: "deeper",
  text: "PRIVATE words",
  promptText: "PRIVATE prompt",
  photoRef: "photo-1",
  ...extra,
});

let storage;
let fake;
let loadClient;
let seedCounter;

function make(overrides = {}) {
  return createSharedSky({
    url: "https://example.convex.cloud",
    storage,
    loadClient,
    now: () => NOW,
    random: () => (seedCounter += 1),
    uuid: () => "123e4567-e89b-42d3-a456-426614174000",
    win: null,
    ...overrides,
  });
}

beforeEach(() => {
  storage = memoryStorage();
  fake = fakeClient();
  seedCounter = 1000;
  loadClient = vi.fn(async () => fake);
});

describe("off by default", () => {
  it("never loads the client, stores nothing and queues nothing", async () => {
    const sky = make();
    expect(sky.isEnabled()).toBe(false);
    await sky.init();
    expect(await sky.publishEntry(entry("a"))).toBe(false);
    expect(loadClient).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it("is unavailable and inert without a Convex URL, even if the flag is set", async () => {
    storage.setItem("dayByDay.shared.enabled.v1", "1");
    const sky = make({ url: "" });
    expect(sky.isAvailable()).toBe(false);
    expect(sky.isEnabled()).toBe(false);
    await sky.init();
    expect(await sky.setEnabled(true)).toBe(false);
    expect(await sky.publishEntry(entry("a"))).toBe(false);
    expect(loadClient).not.toHaveBeenCalled();
  });
});

describe("publishing", () => {
  it("creates a random device id on first enable and sends only the five anonymous fields", async () => {
    const sky = make();
    await sky.setEnabled(true);
    expect(isDeviceId(storage.getItem("dayByDay.shared.device.v1"))).toBe(true);
    await sky.publishEntry(entry("2026-11-16T21:30:00.000Z-123"));

    expect(fake.client.calls).toHaveLength(1);
    const { ref, args } = fake.client.calls[0];
    expect(ref).toBe("stars:publish");
    expect(Object.keys(args).sort()).toEqual(["day", "depth", "deviceId", "seed", "topic"]);
    expect(args).toMatchObject({ topic: "gratitude", depth: "deeper", day: "2026-11-16" });
    expect(validateStar(args, "2026-11-16")).toEqual({ ok: true });

    const everything = JSON.stringify(fake.client.calls) + JSON.stringify([...storage.map.values()]);
    for (const secret of ["PRIVATE", "photo-1", "2026-11-16T21:30:00.000Z-123", "21:30"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("is idempotent: the same entry never publishes twice, even after a restart", async () => {
    const sky = make();
    await sky.setEnabled(true);
    expect(await sky.publishEntry(entry("same"))).toBe(true);
    expect(await sky.publishEntry(entry("same"))).toBe(false);
    expect(fake.client.calls).toHaveLength(1);

    const restarted = make();
    await restarted.init();
    expect(await restarted.publishEntry(entry("same"))).toBe(false);
    expect(fake.client.calls).toHaveLength(1);
    expect(await restarted.publishEntry(entry("other"))).toBe(true);
    expect(fake.client.calls).toHaveLength(2);
  });

  it("keeps stars queued while offline and publishes each exactly once when back online", async () => {
    const sky = make();
    await sky.setEnabled(true);
    fake.client.offline = true;
    await sky.publishEntry(entry("one"));
    await sky.publishEntry(entry("two"));
    await sky.publishEntry(entry("two")); // duplicate while queued
    expect(JSON.parse(storage.getItem("dayByDay.shared.queue.v1"))).toHaveLength(2);
    expect(sky.getSnapshot().status).toBe("offline");

    fake.client.offline = false;
    await sky.flush();
    expect(fake.client.calls.map((c) => c.args.seed)).toEqual([1001, 1002]);
    expect(JSON.parse(storage.getItem("dayByDay.shared.queue.v1"))).toEqual([]);
    await sky.flush();
    expect(fake.client.calls).toHaveLength(2);
  });

  it("drops a star the server rejects (retrying cannot help) but keeps it marked as published", async () => {
    const sky = make();
    await sky.setEnabled(true);
    fake.client.rejectWith = "rate_limited";
    await sky.publishEntry(entry("x"));
    expect(JSON.parse(storage.getItem("dayByDay.shared.queue.v1"))).toEqual([]);
    fake.client.rejectWith = null;
    expect(await sky.publishEntry(entry("x"))).toBe(false);
  });

  it("does not publish entries that are not from about today", async () => {
    const sky = make();
    await sky.setEnabled(true);
    expect(await sky.publishEntry(entry("old", { date: new Date(2026, 10, 1).toISOString() }))).toBe(false);
    expect(await sky.publishEntry(entry("bad", { topic: "wildcard" }))).toBe(false);
    expect(fake.client.calls).toHaveLength(0);
  });

  it("stores only a one-way key per published entry, never the entry id", async () => {
    const sky = make();
    await sky.setEnabled(true);
    await sky.publishEntry(entry("my-entry-id"));
    const published = storage.getItem("dayByDay.shared.published.v1");
    expect(published).not.toContain("my-entry-id");
    expect(published).toContain(publishedKey("123e4567-e89b-42d3-a456-426614174000", "my-entry-id"));
  });
});

describe("turning off and withdrawing", () => {
  it("turning off disconnects, clears the queue and stops publishing", async () => {
    const sky = make();
    await sky.setEnabled(true);
    fake.client.offline = true;
    await sky.publishEntry(entry("queued"));
    await sky.setEnabled(false);
    expect(fake.client.closed).toBe(true);
    expect(storage.getItem("dayByDay.shared.queue.v1")).toBeNull();
    fake.client.offline = false;
    expect(await sky.publishEntry(entry("later"))).toBe(false);
    expect(fake.client.calls).toHaveLength(0);
  });

  it("withdraw removes remote stars, forgets local state and rotates the device id", async () => {
    const ids = ["123e4567-e89b-42d3-a456-426614174000", "223e4567-e89b-42d3-a456-426614174000"];
    const sky = make({ uuid: () => ids.shift() });
    await sky.setEnabled(true);
    await sky.publishEntry(entry("a"));
    const result = await sky.withdraw();
    expect(result).toEqual({ ok: true, removed: 3 });
    const call = fake.client.calls.at(-1);
    expect(call.ref).toBe("stars:withdraw");
    expect(call.args).toEqual({ deviceId: "123e4567-e89b-42d3-a456-426614174000" });
    expect(sky.isEnabled()).toBe(false);
    expect(storage.getItem("dayByDay.shared.device.v1")).toBeNull();
    expect(storage.getItem("dayByDay.shared.published.v1")).toBeNull();

    await sky.setEnabled(true);
    expect(storage.getItem("dayByDay.shared.device.v1")).toBe("223e4567-e89b-42d3-a456-426614174000");
  });

  it("withdraw fails soft when offline and changes nothing locally", async () => {
    const sky = make();
    await sky.setEnabled(true);
    await sky.publishEntry(entry("a"));
    fake.client.offline = true;
    expect(await sky.withdraw()).toEqual({ ok: false, removed: 0 });
    expect(sky.isEnabled()).toBe(true);
    expect(storage.getItem("dayByDay.shared.device.v1")).not.toBeNull();
  });

  it("withdraw with nothing ever shared needs no network", async () => {
    const sky = make();
    expect(await sky.withdraw()).toEqual({ ok: true, removed: 0 });
    expect(loadClient).not.toHaveBeenCalled();
  });
});

describe("the shared field", () => {
  it("fails soft when the client cannot load", async () => {
    loadClient = vi.fn(async () => {
      throw new Error("chunk failed");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sky = make();
    await sky.setEnabled(true);
    expect(sky.getSnapshot().status).toBe("offline");
    expect(await sky.publishEntry(entry("a"))).toBe(true); // queued locally, nothing thrown
  });

  it("exposes others' stars and count, hiding your own", async () => {
    const sky = make();
    await sky.setEnabled(true);
    await sky.publishEntry(entry("mine")); // seed 1001, topic gratitude, depth deeper
    const updates = [];
    sky.subscribe((s) => updates.push(s));

    const today = fake.client.subs.find((s) => s.ref === "stars:today");
    const count = fake.client.subs.find((s) => s.ref === "stars:countToday");
    expect(today.args).toEqual({ day: "2026-11-16" });
    today.cb([
      { topic: "gratitude", depth: "deeper", seed: 1001 },
      { topic: "work", depth: "bold", seed: 5 },
      { topic: "work", depth: "bold", seed: 6 },
    ]);
    count.cb(3);

    const snapshot = sky.getSnapshot();
    expect(snapshot.status).toBe("live");
    expect(snapshot.count).toBe(2);
    expect(snapshot.stars).toEqual([
      { topic: "work", depth: "bold", seed: 5 },
      { topic: "work", depth: "bold", seed: 6 },
    ]);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("ignores malformed stars from the server", async () => {
    const sky = make();
    await sky.setEnabled(true);
    fake.client.subs
      .find((s) => s.ref === "stars:today")
      .cb([{ topic: "nope", depth: "bold", seed: 1 }, { topic: "self", depth: "bold", seed: 2.5 }, null]);
    expect(sky.getSnapshot().stars).toEqual([]);
  });
});
