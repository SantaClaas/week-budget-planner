import type { Activity, Block, Plan } from "./types";

/** The activity's weekly budget in minutes. */
export const target = (activity: Pick<Activity, "mode" | "mins" | "days">): number =>
  activity.mode === "day" ? activity.mins * activity.days : activity.mins;

/** Minutes placed per activity id. */
export function placedByActivity(blocks: readonly Block[]): Map<string, number> {
  const placed = new Map<string, number>();
  for (const block of blocks) placed.set(block.act, (placed.get(block.act) ?? 0) + block.dur);
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
  left: number;
  /** Sum of what activities are over their budget. */
  over: number;
};

export function summarize(plan: Pick<Plan, "activities" | "blocks">): Summary {
  const placed = placedByActivity(plan.blocks);
  const summary: Summary = { budget: 0, placed: 0, left: 0, over: 0 };
  for (const activity of plan.activities) {
    const budget = target(activity);
    const done = placed.get(activity.id) ?? 0;
    summary.budget += budget;
    summary.placed += done;
    if (done < budget) summary.left += budget - done;
    else summary.over += done - budget;
  }
  return summary;
}

/**
 * How a progress indicator splits up, as fractions of its full width. The bar spans whichever is
 * larger, the budget or what's placed. Over budget, `within` is the budget's share and `over` the
 * overrun's; otherwise `over` is zero and `within` is the filled share of the track.
 */
export function progressParts(budget: number, placed: number): { within: number; over: number } {
  if (budget <= 0) return { within: 0, over: placed > 0 ? 1 : 0 };
  if (placed <= budget) return { within: placed / budget, over: 0 };
  return { within: budget / placed, over: (placed - budget) / placed };
}
