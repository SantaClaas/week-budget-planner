import exampleWeek from "../../examples/example-week.json";
import type { IdGenerator } from "./id.ts";
import { sanitizePlan } from "./sanitize.ts";
import type { Plan } from "./index.ts";

/** The example week from examples/example-week.json, marked as loaded at `now`. */
export function createExampleWeek(now: Temporal.Instant, ids: IdGenerator): Plan {
  return { ...sanitizePlan(exampleWeek, ids), exampleLoadedAt: now.toString() };
}
