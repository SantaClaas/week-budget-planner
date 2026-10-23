import exampleWeek from "../../examples/example-week.json";
import { sanitizePlan } from "./sanitize.ts";
import type { Plan } from "./types.ts";

/** The example week from examples/example-week.json, marked as loaded at `now`. */
export function createExampleWeek(now = Temporal.Now.instant()): Plan {
  return { ...sanitizePlan(exampleWeek), exampleLoadedAt: now.toString() };
}
