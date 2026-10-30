import type { Activity } from "../activity/index.ts";
import { calculateWeeklyBudget, sumPlacedByActivity } from "../budget.ts";
import type { Plan } from "../index.ts";
import { DAY, MAX_LENGTH, SLOT, clamp, sanitizeLength, type Length } from "../time.ts";
import type { Block } from "./index.ts";

/** Default length for activities counted per week: one lecture slot. */
const WEEKLY_DEFAULT_LENGTH = 90;

/**
 * The length a new block gets: the per-day budget for per-day activities, otherwise one lecture
 * slot, capped at what's left when something is, never under one slot or over a day.
 */
export function pickDefaultLength(activity: Activity, blocks: readonly Block[]): Length {
  const left =
    calculateWeeklyBudget(activity) - (sumPlacedByActivity(blocks).get(activity.id) ?? 0);
  let length: number = activity.mode === "day" ? activity.budgetMinutes : WEEKLY_DEFAULT_LENGTH;
  if (left > 0) length = Math.min(length, left);
  return sanitizeLength(clamp(length, SLOT, MAX_LENGTH));
}

/**
 * Caps a new block's length so that a block starting inside the day hours ends by their end.
 * Blocks starting outside the day hours keep their length.
 */
export function fitToDayHours(
  start: number,
  length: Length,
  plan: Pick<Plan, "dayStart" | "dayEnd">,
): Length {
  const dayStart = plan.dayStart * 60;
  const dayEnd = plan.dayEnd * 60;
  if (start < dayStart || start >= dayEnd) return length;
  return sanitizeLength(clamp(Math.min(length, dayEnd - start), SLOT, DAY));
}
