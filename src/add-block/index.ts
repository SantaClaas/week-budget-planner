/**
 * What the Add block chooser lists, worked out from the plan as pure data (see Adding blocks in
 * docs/spec/interactions.md): the activities, those with the most left to place first, each with
 * the length a block of it would get and what's left of it.
 */
import type { Activity } from "../plan/activity/index.ts";
import type { Block } from "../plan/block/index.ts";
import { fitToDayHours, pickDefaultLength } from "../plan/block/length.ts";
import { calculateWeeklyBudget, readPlaced, sumPlacedByActivity } from "../plan/budget.ts";
import {
  formatClock,
  formatClockRange,
  formatLength,
  formatWeekday,
  type Format,
} from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import type { Slot } from "../plan/slot.ts";
import type { Length } from "../plan/time.ts";

/** One activity in the chooser. */
export type Choice = {
  activity: Activity;
  /** Whether some of its budget is left, so a block wouldn't take it over budget. */
  isWithinBudget: boolean;
  /** The length a block of it gets at the slot: its default length, ended by the day hours. */
  length: Length;
  /** "3 hr left · usually 1 hr, 30 min", "All placed · this would go over budget". */
  description: string;
};

/** What's left of an activity, as its description in the chooser says it. */
function describeLeft(activity: Activity, left: number, format: Format): string {
  if (left === 0) return "All placed · this would go over budget";
  if (left < 0) return `${formatLength(left, "short", format)} over budget`;
  const usually =
    activity.mode === "day"
      ? ` · usually ${formatLength(activity.budgetMinutes, "short", format)}`
      : "";
  return `${formatLength(left, "short", format)} left${usually}`;
}

/**
 * The chooser's activities for a block at `slot`, those with the most left to place first, so
 * those that are all placed or over budget come last.
 */
export function listChoices(
  plan: Pick<Plan, "activities" | "blocks" | "dayStart" | "dayEnd">,
  slot: Slot,
  format: Format = {},
): Choice[] {
  const placed = sumPlacedByActivity(plan.blocks);
  return plan.activities
    .map((activity) => {
      const left = calculateWeeklyBudget(activity) - readPlaced(placed, activity.id);
      const length = fitToDayHours(slot.start, pickDefaultLength(activity, plan.blocks), plan);
      return {
        activity,
        left,
        choice: {
          activity,
          isWithinBudget: left > 0,
          length,
          description: describeLeft(activity, left, format),
        },
      };
    })
    .toSorted((first, second) => second.left - first.left)
    .map((each) => each.choice);
}

/** The slot as the menu's heading says it: "Friday 14:00". */
export const describeSlot = (slot: Slot, format: Format = {}): string =>
  `${formatWeekday(slot.day, "long", format)} ${formatClock(slot.start, format)}`;

/** The slot as the bottom sheet says it under its title: "Friday · from 14:00". */
export const describeStart = (slot: Slot, format: Format = {}): string =>
  `${formatWeekday(slot.day, "long", format)} · from ${formatClock(slot.start, format)}`;

/** The snackbar after a block was added: "Added Gym · Tue 10:00–11:30". */
export const describeAdded = (activity: Activity, block: Block, format: Format = {}): string =>
  `Added ${activity.name} · ${formatWeekday(block.day, "short", format)} ${formatClockRange(block.start, block.start + block.length, format)}`;
