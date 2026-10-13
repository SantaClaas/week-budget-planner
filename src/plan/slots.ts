import { DAY, SLOT, type Activity, type Block, type Plan } from "./types";
import { rangesOverlap, weekStart } from "./week";

/** Whether a block of `length` starting at `day`/`start` would overlap any existing block. */
export function isFree(
  blocks: readonly Block[],
  day: number,
  start: number,
  length: number,
): boolean {
  const from = day * DAY + start;
  return !blocks.some((block) => rangesOverlap(from, length, weekStart(block), block.dur));
}

/**
 * The earliest gap that fits `length`, scanning Monday to Sunday in slot steps within the day
 * hours. For per-day activities, days that don't have the activity yet come first.
 */
export function firstFreeSlot(
  plan: Pick<Plan, "blocks" | "dayStart" | "dayEnd">,
  activity: Activity,
  length: number,
): { day: number; start: number } | undefined {
  const days = [0, 1, 2, 3, 4, 5, 6];
  const taken = new Set(
    plan.blocks.filter((block) => block.act === activity.id).map((block) => block.day),
  );
  const order =
    activity.mode === "day"
      ? [...days.filter((day) => !taken.has(day)), ...days.filter((day) => taken.has(day))]
      : days;
  const from = plan.dayStart * 60;
  const to = plan.dayEnd * 60;
  for (const day of order) {
    for (let start = from; start + length <= to; start += SLOT) {
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
export function openingMinute(plan: Pick<Plan, "blocks" | "dayStart">): number {
  let earliest = plan.dayStart * 60;
  for (const block of plan.blocks) earliest = Math.min(earliest, block.start);
  return Math.floor(earliest / 60) * 60;
}
