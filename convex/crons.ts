import { anyApi, cronJobs } from "convex/server";

// Same shape as the generated `internal` object, without needing codegen.
const internal = anyApi as any;

const crons = cronJobs();

// Stars live for a few days at most (RETENTION_DAYS in shared/star-rules.js); sweep them once a day.
crons.daily("delete expired stars", { hourUTC: 3, minuteUTC: 17 }, internal.stars.cleanup, {});

export default crons;
