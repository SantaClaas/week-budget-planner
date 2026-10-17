import {
  SLOT,
  sanitizeDayIndex,
  sanitizeDayMinute,
  type DayIndex,
  type DayMinute,
  type Length,
} from "./time";
import type { Activity, Block, Plan } from "./types";
import { isRangeOverlapping, calculateWeekStart } from "./week";

/** Whether a block of `length` starting at `day`/`start` would overlap any existing block. */
export function isFree(
  blocks: readonly Block[],
  day: DayIndex,
  start: DayMinute,
  length: Length,
): boolean {
  const from = calculateWeekStart({ day, start });
  return !blocks.some((block) =>
    isRangeOverlapping(from, length, calculateWeekStart(block), block.length),
  );
}

const DAYS = [0, 1, 2, 3, 4, 5, 6].map((day) => sanitizeDayIndex(day));

/**
 * The earliest gap that fits `length`, scanning Monday to Sunday in slot steps within the day
 * hours. For per-day activities, days that don't have the activity yet come first.
 */
export function findFirstFreeSlot(
  plan: Pick<Plan, "blocks" | "dayStart" | "dayEnd">,
  activity: Activity,
  length: Length,
): { day: DayIndex; start: DayMinute } | undefined {
  const taken = new Set(
    plan.blocks.filter((block) => block.activityId === activity.id).map((block) => block.day),
  );
  const order =
    activity.mode === "day"
      ? [...DAYS.filter((day) => !taken.has(day)), ...DAYS.filter((day) => taken.has(day))]
      : DAYS;
  const to = plan.dayEnd * 60;
  for (const day of order) {
    for (let minute = plan.dayStart * 60; minute + length <= to; minute += SLOT) {
      const start = sanitizeDayMinute(minute);
      if (isFree(plan.blocks, day, start, length)) return { day, start };
    }
  }
  return undefined;
}

/**
 * Where the week opens: the earlier of the day hours' start and the earliest block start, rounded
 * down to the hour, in minutes. Only block starts count, so the second part of an overnight block
 * (which always begins at 00:00) never pins the view to midnight.
 */
export function findOpeningMinute(plan: Pick<Plan, "blocks" | "dayStart">): number {
  let earliest = plan.dayStart * 60;
  for (const block of plan.blocks) earliest = Math.min(earliest, block.start);
  return Math.floor(earliest / 60) * 60;
}
