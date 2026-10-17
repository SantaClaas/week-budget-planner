import { sanitizePlan } from "./sanitize";
import { createEmptyPlan, type Plan } from "./types";

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
      blocks: plan.blocks.map(({ id, activityId, day, start, length }) => ({
        id,
        activityId,
        day,
        start,
        length,
      })),
    },
    null,
    2,
  );
}

/**
 * Reads an imported plan file strictly, so an import never replaces the plan with an empty one:
 * "not-a-plan" when the text isn't JSON or isn't a plan in the stored format, "newer-version"
 * when a newer version of the app wrote it (a `version` above 1).
 */
export function read(text: string): Plan | "not-a-plan" | "newer-version" {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "not-a-plan";
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    typeof data.version !== "number"
  ) {
    return "not-a-plan";
  }
  if (data.version > 1) return "newer-version";
  return data.version === 1 ? sanitizePlan(data) : "not-a-plan";
}

/** Parses a plan file or stored JSON. Anything malformed becomes a valid (possibly empty) plan. */
export function parse(text: string): Plan {
  try {
    return sanitizePlan(JSON.parse(text));
  } catch {
    return createEmptyPlan();
  }
}
