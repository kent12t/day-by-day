import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The whole shared sky: one anonymous row per published star. There is no text, no photo, no entry id, no exact
// timestamp and no account here, by design (issue #3). `deviceId` is a random UUID the browser made up; it is only
// used for the daily rate limit and for "Stop sharing & remove my stars", and is never returned by any query.
export default defineSchema({
  stars: defineTable({
    deviceId: v.string(),
    topic: v.string(),
    depth: v.string(),
    day: v.string(), // the sharer's local day, YYYY-MM-DD
    seed: v.number(), // random int, used only to place the star
  })
    .index("by_day", ["day"])
    .index("by_device_day", ["deviceId", "day"]),
});
