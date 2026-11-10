import {
  DAY,
  SLOT,
  WEEK,
  sanitizeDayIndex,
  sanitizeDayMinute,
  type DayIndex,
  type DayMinute,
  type Length,
  sanitizeLength,
} from "./time.ts";
import type { Activity } from "./activity/index.ts";
import type { Block } from "./block/index.ts";
import type { Plan } from "./index.ts";
import { calculateWeekStart, convertFromWeekMinutes, isRangeOverlapping } from "./week.ts";

/** A slot on the week: its day, and the minute it starts. */
export type Slot = { day: DayIndex; start: DayMinute };

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
): Slot | undefined {
  const taken = new Set(
    plan.blocks
      .values()
      .filter((block) => block.activityId === activity.id)
      .map((block) => block.day),
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

const ONE_SLOT = sanitizeLength(SLOT);

/** Whether no block covers the slot that starts `minute` minutes into the week. */
const isEmpty = (blocks: readonly Block[], minute: number): boolean => {
  const { day, start } = convertFromWeekMinutes(minute);
  return isFree(blocks, day, start, ONE_SLOT);
};

/**
 * The empty slot the keyboard reaches the empty slots through (see The week in
 * docs/spec/accessibility.md): `from` while it's empty, else the next empty slot after it, around
 * the week. Without `from`, the first empty slot of the day hours, Monday to Sunday, or else the
 * first one of the week. Nothing when every slot is covered.
 */
export function findEmptySlot(
  plan: Pick<Plan, "blocks" | "dayStart" | "dayEnd">,
  from?: Slot,
): Slot | undefined {
  if (from !== undefined) {
    const start = calculateWeekStart(from);
    for (let step = 0; step < WEEK; step += SLOT) {
      const minute = (start + step) % WEEK;
      if (isEmpty(plan.blocks, minute)) return convertFromWeekMinutes(minute);
    }
    return undefined;
  }
  for (const day of DAYS) {
    for (let minute = plan.dayStart * 60; minute < plan.dayEnd * 60; minute += SLOT) {
      if (isEmpty(plan.blocks, day * DAY + minute))
        return convertFromWeekMinutes(day * DAY + minute);
    }
  }
  return findEmptySlot(plan, { day: sanitizeDayIndex(0), start: sanitizeDayMinute(0) });
}

/** A key that moves the empty slot: 15 minutes, an hour or a day, earlier or later. */
export type SlotMove =
  | "earlier"
  | "later"
  | "hour-earlier"
  | "hour-later"
  | "day-earlier"
  | "day-later";

/** How far each move goes first, and the step it takes on over covered slots. */
const MOVES: Record<SlotMove, { distance: number; step: number }> = {
  earlier: { distance: -SLOT, step: -SLOT },
  later: { distance: SLOT, step: SLOT },
  "hour-earlier": { distance: -60, step: -SLOT },
  "hour-later": { distance: 60, step: SLOT },
  "day-earlier": { distance: -DAY, step: -DAY },
  "day-later": { distance: DAY, step: DAY },
};

/**
 * Where the empty slot goes on a key: 15 minutes, an hour or a day on, past the slots that blocks
 * cover, across midnight but never past the week's ends (Monday 00:00 and Sunday 23:45). Nothing
 * when there's no empty slot that way, so the key does nothing.
 */
export function moveEmptySlot(
  blocks: readonly Block[],
  from: Slot,
  move: SlotMove,
): Slot | undefined {
  const { distance, step } = MOVES[move];
  for (
    let minute = calculateWeekStart(from) + distance;
    minute >= 0 && minute < WEEK;
    minute += step
  ) {
    if (isEmpty(blocks, minute)) return convertFromWeekMinutes(minute);
  }
  return undefined;
}
