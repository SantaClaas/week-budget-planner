import { sanitizePlan } from "./sanitize";
import type { Plan } from "./types";

/** The stored format, as in examples/example-week.json, with keys in a stable order. */
export function serialize(plan: Plan): string {
  return JSON.stringify(
    {
      version: 1,
      exampleLoadedAt: plan.exampleLoadedAt,
      dayStart: plan.dayStart,
      dayEnd: plan.dayEnd,
      activities: plan.activities.map(({ id, name, hue, shape, mode, budgetMinutes, days }) => ({
        id,
        name,
        hue,
        shape,
        mode,
        budgetMinutes,
        days,
      })),
      blocks: plan.blocks.map(({ id, activityId, day, start, length }) => ({ id, activityId, day, start, length })),
    },
    null,
    2,
  );
}

/** Parses a plan file or stored JSON. Anything malformed becomes a valid (possibly empty) plan. */
export function parse(text: string): Plan {
  try {
    return sanitizePlan(JSON.parse(text));
  } catch {
    return sanitizePlan(undefined);
  }
}
