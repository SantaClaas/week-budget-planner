import { createSignal } from "solid-js";

import { announce } from "../announcement/index.ts";
import type { Activity } from "../plan/activity/index.ts";
import { calculateWeeklyBudget, readPlaced, sumPlacedByActivity } from "../plan/budget.ts";
import type { Block } from "../plan/block/index.ts";
import * as list from "../plan/block/list.ts";
import { randomIds, type ActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex, DayMinute, Length } from "../plan/time.ts";
import type { Planner } from "../planner/index.ts";
import { announceChange } from "../week/layout.ts";
import * as selection from "../week/selection.ts";

/**
 * Adding blocks without the Add block chooser (see Adding blocks in docs/spec/interactions.md):
 * the activity that's placing, the dashed preview of where a block would land, and the chip that
 * follows the pointer while an activity is dragged from the list. The Activities list, the week
 * and the toolbar all read and change it, so it's app-wide state: globals, as Solid's cheatsheet
 * advises.
 */

/** Where a new block would land, drawn as a dashed outline on its day. */
type Preview = { activityId: ActivityId; day: DayIndex; start: DayMinute; length: Length };

/** The chip that follows the pointer while an activity is dragged from the list. */
type Chip = { activityId: ActivityId; length: Length; x: number; y: number };

const [current, setCurrent] = createSignal<ActivityId>();
const [preview, setPreview] = createSignal<Preview>();
const [chip, setChip] = createSignal<Chip>();

export { chip, current, preview };

/** Starts placing the activity `id`: each empty slot picked adds a block of it. */
export function start(id: ActivityId): void {
  setCurrent(id);
}

/** Stops placing. */
export function stop(): void {
  setCurrent(undefined);
  setPreview(undefined);
}

/** Shows where a new block would land. */
export function showPreview(shown: Preview): void {
  setPreview(shown);
}

/** Hides the preview. */
export function hidePreview(): void {
  setPreview(undefined);
}

/** Shows the chip at the pointer. */
export function showChip(shown: Chip): void {
  setChip(shown);
}

/** Hides the chip. */
export function hideChip(): void {
  setChip(undefined);
}

/** Whether `activity` has nothing left to place in `plan`. */
const isAllPlaced = (plan: Plan, activity: Activity): boolean =>
  readPlaced(sumPlacedByActivity(plan.blocks), activity.id) >= calculateWeeklyBudget(activity);

/**
 * Adds a block of `activity` at the slot, with the default length, selects it and says so, and
 * gives it back. Placing stops by itself once the activity is all placed.
 */
export function addBlock(
  planner: Planner,
  activity: Activity,
  slot: { day: DayIndex; start: DayMinute },
): Block | undefined {
  let added: { block: Block; plan: Plan } | undefined;
  planner.change((plan) => {
    const block = list.create(plan, activity, slot, randomIds.createBlockId());
    added = { block, plan: list.add(plan, block) };
    return added.plan;
  });
  if (added === undefined) return undefined;
  selection.select(added.block.id);
  announce(announceChange("added", added.block, activity));
  if (current() === activity.id && isAllPlaced(added.plan, activity)) stop();
  return added.block;
}
