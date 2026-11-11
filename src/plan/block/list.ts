// The plan's blocks: changing and removing one. Each function gives back a new plan and leaves the
// one it was given as it was (see "A pure core" in docs/guidelines/principles.md).
import type { Activity } from "../activity/index.ts";
import type { BlockId } from "../id.ts";
import type { Plan } from "../index.ts";
import type { DayIndex, DayMinute } from "../time.ts";
import type { Block } from "./index.ts";
import { fitToDayHours, pickDefaultLength } from "./length.ts";

/**
 * The plan with `block` in place of the block with its id. The same plan when there's no such
 * block, or it's unchanged, so the planner records no undo step.
 */
export function update(plan: Plan, block: Block): Plan {
  const before = plan.blocks.find((existing) => existing.id === block.id);
  if (before === undefined) return plan;
  // Every field but the id, by name: a new field on Block has to be added here too. A test in
  // ./list.test.ts fails until it is.
  const isUnchanged =
    block.activityId === before.activityId &&
    block.day === before.day &&
    block.start === before.start &&
    block.length === before.length;
  if (isUnchanged) return plan;
  return {
    ...plan,
    blocks: plan.blocks.map((existing) => (existing.id === block.id ? block : existing)),
  };
}

/** The plan without the block `id`. The same plan when there's no such block. */
export function remove(plan: Plan, id: BlockId): Plan {
  if (!plan.blocks.some((block) => block.id === id)) return plan;
  return { ...plan, blocks: plan.blocks.filter((block) => block.id !== id) };
}

/**
 * A new block of `activity` at the slot, with the default length (see the glossary), ended by the
 * end of the day hours when it starts inside them. The plan isn't changed: `add` puts it in.
 */
export function create(
  plan: Pick<Plan, "blocks" | "dayStart" | "dayEnd">,
  activity: Activity,
  slot: { day: DayIndex; start: DayMinute },
  id: BlockId,
): Block {
  const length = fitToDayHours(slot.start, pickDefaultLength(activity, plan.blocks), plan);
  return { id, activityId: activity.id, day: slot.day, start: slot.start, length };
}

/** The plan with `block` added. */
export const add = (plan: Plan, block: Block): Plan => ({
  ...plan,
  blocks: [...plan.blocks, block],
});

/** The plan without any blocks, as Clear week leaves it. The same plan when it has none. */
export const clear = (plan: Plan): Plan =>
  plan.blocks.length === 0 ? plan : { ...plan, blocks: [] };
