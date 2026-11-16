import { ConvexError, v } from "convex/values";
import { internalMutationGeneric, mutationGeneric, queryGeneric } from "convex/server";
import {
  COUNT_LIMIT,
  DEPTHS,
  RETENTION_DAYS,
  TODAY_LIMIT,
  TOPICS,
  isDeviceId,
  isOverRateLimit,
  isValidDayKey,
  retentionCutoffDay,
  toPublicStar,
  utcDayKey,
  validateStar,
} from "../shared/star-rules.js";

// Generic builders, so this type-checks without `convex dev` codegen. After `npx convex dev` has generated
// convex/_generated you may swap these for the typed `query` / `mutation` / `internalMutation`.
const query = queryGeneric;
const mutation = mutationGeneric;
const internalMutation = internalMutationGeneric;

const literals = (values: readonly string[]) => values.map((value) => v.literal(value));
const topicValidator = v.union(...(literals(TOPICS) as [any, any, ...any[]]));
const depthValidator = v.union(...(literals(DEPTHS) as [any, any, ...any[]]));

// Publish one anonymous star. Strict validators reject any extra field; the shared rules re-check enums, the
// date format, the day window and the per-device daily limit.
export const publish = mutation({
  args: {
    deviceId: v.string(),
    topic: topicValidator,
    depth: depthValidator,
    day: v.string(),
    seed: v.number(),
  },
  handler: async (ctx, args) => {
    const verdict = validateStar(args, utcDayKey());
    if (!verdict.ok) throw new ConvexError({ code: verdict.code, message: verdict.message });

    const existing = await ctx.db
      .query("stars")
      .withIndex("by_device_day", (q: any) => q.eq("deviceId", args.deviceId).eq("day", args.day))
      .take(50);
    if (isOverRateLimit(existing.length)) {
      throw new ConvexError({ code: "rate_limited", message: "Too many stars from this device today." });
    }

    await ctx.db.insert("stars", {
      deviceId: args.deviceId,
      topic: args.topic,
      depth: args.depth,
      day: args.day,
      seed: args.seed,
    });
    return { ok: true };
  },
});

// Today's stars: ONLY topic, depth and seed. Never the device id.
export const today = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    if (!isValidDayKey(day)) return [];
    const rows = await ctx.db
      .query("stars")
      .withIndex("by_day", (q: any) => q.eq("day", day))
      .take(TODAY_LIMIT);
    return rows.map(toPublicStar);
  },
});

export const countToday = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    if (!isValidDayKey(day)) return 0;
    const rows = await ctx.db
      .query("stars")
      .withIndex("by_day", (q: any) => q.eq("day", day))
      .take(COUNT_LIMIT);
    return rows.length;
  },
});

// "Stop sharing & remove my stars": deletes every star this device ever published.
export const withdraw = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    if (!isDeviceId(deviceId)) throw new ConvexError({ code: "invalid_device", message: "Invalid device id." });
    // At most 10 stars a day for RETENTION_DAYS days can exist, so one batch always covers them all.
    const rows = await ctx.db
      .query("stars")
      .withIndex("by_device_day", (q: any) => q.eq("deviceId", deviceId))
      .take(1000);
    for (const row of rows) await ctx.db.delete(row._id);
    return { removed: rows.length };
  },
});

// Daily retention sweep (see crons.ts): delete stars older than RETENTION_DAYS.
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = retentionCutoffDay(utcDayKey(), RETENTION_DAYS);
    const rows = await ctx.db
      .query("stars")
      .withIndex("by_day", (q: any) => q.lt("day", cutoff))
      .take(2000);
    for (const row of rows) await ctx.db.delete(row._id);
    return { removed: rows.length };
  },
});
