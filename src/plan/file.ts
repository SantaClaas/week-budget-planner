import type { Result } from "../result.ts";
import type { IdGenerator } from "./id.ts";
import { sanitizePlan } from "./sanitize.ts";
import { createEmptyPlan, type Plan } from "./index.ts";

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

/** Whether a newer version of the app wrote the data: a `version` above 1. */
const isFromNewerVersion = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  "version" in data &&
  typeof data.version === "number" &&
  data.version > 1;

/**
 * Reads an imported plan file strictly, so an import never replaces the plan with an empty one:
 * "not-a-plan" when the text isn't JSON or isn't a plan in the stored format, "newer-version"
 * when a newer version of the app wrote it (a `version` above 1). Invalid ids get new ones from `ids`.
 */
export function read(text: string, ids: IdGenerator): Result<Plan, "not-a-plan" | "newer-version"> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "not-a-plan";
  }
  if (isFromNewerVersion(data)) return "newer-version";
  const isVersionOne =
    typeof data === "object" && data !== null && "version" in data && data.version === 1;
  return isVersionOne ? sanitizePlan(data, ids) : "not-a-plan";
}

/**
 * Whether the stored text is a plan from a newer version of the app, which this version must
 * neither read as its own nor write over. Text that isn't JSON isn't from a newer version.
 */
export function isWrittenByNewerVersion(text: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  return isFromNewerVersion(data);
}

/**
 * Parses stored JSON leniently: anything malformed becomes a valid (possibly empty) plan, and
 * invalid ids get new ones from `ids`. Only a plan from a newer version is refused, with
 * "newer-version", since sanitizing it would drop whatever this version doesn't know.
 */
export function parse(text: string, ids: IdGenerator): Result<Plan, "newer-version"> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return createEmptyPlan();
  }
  if (isFromNewerVersion(data)) return "newer-version";
  return sanitizePlan(data, ids);
}
