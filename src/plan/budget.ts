import type { ActivityId } from "./id.ts";
import type { Activity } from "./activity/index.ts";
import type { Block } from "./block/index.ts";
import type { Plan } from "./index.ts";
import {
  sanitizePlaced,
  sanitizeTotalBudget,
  sanitizeWeeklyBudget,
  type Placed,
  type TotalBudget,
  type WeeklyBudget,
} from "./time.ts";

/** The activity's budget counted per week: per day, the day's budget times its days. */
export const calculateWeeklyBudget = (
  activity: Pick<Activity, "mode" | "budgetMinutes" | "days">,
): WeeklyBudget =>
  sanitizeWeeklyBudget(
    activity.mode === "day" ? activity.budgetMinutes * activity.days : activity.budgetMinutes,
  );

/** The time placed per activity id, for each activity that has blocks. */
export function sumPlacedByActivity(blocks: readonly Block[]): Map<ActivityId, Placed> {
  const totals = new Map<ActivityId, number>();
  for (const block of blocks)
    totals.set(block.activityId, (totals.get(block.activityId) ?? 0) + block.length);
  return new Map(totals.entries().map(([id, minutes]) => [id, sanitizePlaced(minutes)]));
}

/** The time placed of the activity `id`: nothing, when it has no blocks. */
export const readPlaced = (placed: ReadonlyMap<ActivityId, Placed>, id: ActivityId): Placed =>
  placed.get(id) ?? sanitizePlaced(0);

export type Summary = {
  /** Sum of all budgets. */
  budget: TotalBudget;
  /** Sum of all blocks. */
  placed: Placed;
  /** Sum of what each activity still has left (activities over budget count as zero). */
  leftToPlace: number;
  /** Sum of what activities are over their budget. */
  overBudget: number;
};

export function summarize(plan: Pick<Plan, "activities" | "blocks">): Summary {
  const placedByActivity = sumPlacedByActivity(plan.blocks);
  let budget = 0;
  let placed = 0;
  let leftToPlace = 0;
  let overBudget = 0;
  for (const activity of plan.activities) {
    const activityBudget = calculateWeeklyBudget(activity);
    const activityPlaced = readPlaced(placedByActivity, activity.id);
    budget += activityBudget;
    placed += activityPlaced;
    leftToPlace += Math.max(0, activityBudget - activityPlaced);
    overBudget += Math.max(0, activityPlaced - activityBudget);
  }
  return {
    budget: sanitizeTotalBudget(budget),
    placed: sanitizePlaced(placed),
    leftToPlace,
    overBudget,
  };
}

/**
 * How a progress indicator splits up, as fractions of its full width. The bar spans whichever is
 * larger, the budget or what's placed. Over budget, `withinBudget` is the budget's share and
 * `overBudget` the overrun's; otherwise `overBudget` is zero and `withinBudget` is the filled share
 * of the track.
 */
export function splitProgress(
  budget: WeeklyBudget | TotalBudget,
  placed: Placed,
): { withinBudget: number; overBudget: number } {
  if (budget <= 0) return { withinBudget: 0, overBudget: placed > 0 ? 1 : 0 };
  if (placed <= budget) return { withinBudget: placed / budget, overBudget: 0 };
  return { withinBudget: budget / placed, overBudget: (placed - budget) / placed };
}
