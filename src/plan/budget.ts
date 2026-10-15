import type { Activity, Block, Plan } from "./types";

/** The activity's weekly budget in minutes. */
export const target = (activity: Pick<Activity, "mode" | "budgetMinutes" | "days">): number =>
  activity.mode === "day" ? activity.budgetMinutes * activity.days : activity.budgetMinutes;

/** Minutes placed per activity id. */
export function placedByActivity(blocks: readonly Block[]): Map<string, number> {
  const placed = new Map<string, number>();
  for (const block of blocks) placed.set(block.activityId, (placed.get(block.activityId) ?? 0) + block.length);
  return placed;
}

/** Budget minus placed. Negative means over budget. */
export const leftToPlace = (activity: Activity, blocks: readonly Block[]): number =>
  target(activity) - (placedByActivity(blocks).get(activity.id) ?? 0);

export type Summary = {
  /** Sum of all budgets. */
  budget: number;
  /** Sum of all blocks. */
  placed: number;
  /** Sum of what each activity still has left (activities over budget count as zero). */
  leftToPlace: number;
  /** Sum of what activities are over their budget. */
  overBudget: number;
};

export function summarize(plan: Pick<Plan, "activities" | "blocks">): Summary {
  const placed = placedByActivity(plan.blocks);
  const summary: Summary = { budget: 0, placed: 0, leftToPlace: 0, overBudget: 0 };
  for (const activity of plan.activities) {
    const budget = target(activity);
    const done = placed.get(activity.id) ?? 0;
    summary.budget += budget;
    summary.placed += done;
    if (done < budget) summary.leftToPlace += budget - done;
    else summary.overBudget += done - budget;
  }
  return summary;
}

/**
 * How a progress indicator splits up, as fractions of its full width. The bar spans whichever is
 * larger, the budget or what's placed. Over budget, `withinBudget` is the budget's share and
 * `overBudget` the overrun's; otherwise `overBudget` is zero and `withinBudget` is the filled share
 * of the track.
 */
export function progressParts(budget: number, placed: number): { withinBudget: number; overBudget: number } {
  if (budget <= 0) return { withinBudget: 0, overBudget: placed > 0 ? 1 : 0 };
  if (placed <= budget) return { withinBudget: placed / budget, overBudget: 0 };
  return { withinBudget: budget / placed, overBudget: (placed - budget) / placed };
}
