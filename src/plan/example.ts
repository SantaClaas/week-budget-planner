import exampleWeek from "../../examples/example-week.json";
import { sanitizePlan } from "./sanitize";
import type { Plan } from "./types";

/** The example week from examples/example-week.json, marked as loaded at `now`. */
export function createExampleWeek(now = new Date()): Plan {
  return { ...sanitizePlan(exampleWeek), exampleLoadedAt: now.toISOString() };
}
