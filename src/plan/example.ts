import exampleWeek from "../../examples/example-week.json";
import type { IdGenerator } from "./id.ts";
import { sanitizePlan } from "./sanitize.ts";
import { createEmptyPlan, type Plan } from "./index.ts";

/** The example week from examples/example-week.json, marked as loaded at `now`. */
export function createExampleWeek(now: Temporal.Instant, ids: IdGenerator): Plan {
  return { ...sanitizePlan(exampleWeek, ids), exampleLoadedAt: now.toString() };
}

/** "Keep these": the plan as it is, no longer marked as the example week. */
export const keepExampleWeek = (plan: Plan): Plan =>
  plan.exampleLoadedAt === null ? plan : { ...plan, exampleLoadedAt: null };

/** "Start empty": no activities and no blocks. The day hours stay as they were. */
export const startEmpty = (plan: Plan): Plan => ({
  ...createEmptyPlan(),
  dayStart: plan.dayStart,
  dayEnd: plan.dayEnd,
});
