import { sanitizePlan } from "../plan/sanitize";
import type { Plan } from "../plan/types";

/** The stored format, as in examples/example-week.json, with keys in a stable order. */
export function serializePlan(plan: Plan): string {
  return JSON.stringify(
    {
      v: 1,
      example: plan.example,
      dayStart: plan.dayStart,
      dayEnd: plan.dayEnd,
      activities: plan.activities.map(({ id, name, hue, shape, mode, mins, days }) => ({
        id,
        name,
        hue,
        shape,
        mode,
        mins,
        days,
      })),
      blocks: plan.blocks.map(({ id, act, day, start, dur }) => ({ id, act, day, start, dur })),
    },
    null,
    2,
  );
}

/** Parses a plan file or stored JSON. Anything malformed becomes a valid (possibly empty) plan. */
export function parsePlan(text: string): Plan {
  try {
    return sanitizePlan(JSON.parse(text));
  } catch {
    return sanitizePlan(undefined);
  }
}

/** "2026-10-13" in the local time zone, for export file names. */
export function localDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
