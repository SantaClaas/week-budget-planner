/**
 * What the Activities list shows, worked out from the plan as pure data, so it can be tested
 * without a page: each activity's budget line, what's left to place, and the list's overview (see
 * Layout in docs/spec/layout.md).
 */
import type { Activity } from "../plan/activity/index.ts";
import { calculateWeeklyBudget, summarize, sumPlacedByActivity } from "../plan/budget.ts";
import { formatLength, type Format } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";

/** Whether an activity has some left to place, is all placed, or has more placed than its budget. */
type LeftState = "left" | "all-placed" | "over-budget";

/** One activity as its row in the list shows it. */
export type ActivityRow = {
  activity: Activity;
  /** "4 hr, 30 min per week" or "1 hr, 30 min per day, 3 days". */
  budget: string;
  state: LeftState;
  /** The figure on the right: "1 hr, 30 min", "All placed" or, over budget, by how much. */
  figure: string;
  /** Under the figure: "left to place", the weekly budget when all placed, or "over budget". */
  caption: string;
  /** The weekly budget and what's placed, in minutes, for the progress indicator. */
  weeklyBudget: number;
  placedMinutes: number;
  /** The total length of its blocks, for the form's "4 hr, 30 min placed". */
  placed: string;
};

/** The budget line: "4 hr, 30 min per week" or "1 hr, 30 min per day, 3 days". */
function describeBudget(activity: Activity, format: Format): string {
  const length = formatLength(activity.budgetMinutes, "short", format);
  if (activity.mode === "week") return `${length} per week`;
  return `${length} per day, ${String(activity.days)} ${activity.days === 1 ? "day" : "days"}`;
}

function drawRow(activity: Activity, placed: number, format: Format): ActivityRow {
  const budget = calculateWeeklyBudget(activity);
  const left = budget - placed;
  const state: LeftState = left > 0 ? "left" : left === 0 ? "all-placed" : "over-budget";
  return {
    activity,
    budget: describeBudget(activity, format),
    state,
    figure: state === "all-placed" ? "All placed" : formatLength(left, "short", format),
    caption: {
      left: "left to place",
      "all-placed": formatLength(budget, "short", format),
      "over-budget": "over budget",
    }[state],
    weeklyBudget: budget,
    placedMinutes: placed,
    placed: `${formatLength(placed, "short", format)} placed`,
  };
}

/** Every activity's row, in the plan's order. */
export function listRows(
  plan: Pick<Plan, "activities" | "blocks">,
  format: Format = {},
): ActivityRow[] {
  const placed = sumPlacedByActivity(plan.blocks);
  return plan.activities.map((activity) => drawRow(activity, placed.get(activity.id) ?? 0, format));
}

/**
 * The list's overview, in two parts for the two weights it's drawn in: "12 hr left to place" and
 * "across 4 activities · 1 over budget", or "All placed" when nothing is left.
 */
export function describeOverview(
  plan: Pick<Plan, "activities" | "blocks">,
  format: Format = {},
): { leftToPlace: string; detail: string } {
  const { leftToPlace } = summarize(plan);
  const placed = sumPlacedByActivity(plan.blocks);
  const overBudget = plan.activities.filter(
    (activity) => (placed.get(activity.id) ?? 0) > calculateWeeklyBudget(activity),
  ).length;
  const count = plan.activities.length;
  const activities = `${String(count)} ${count === 1 ? "activity" : "activities"}`;
  return {
    leftToPlace:
      leftToPlace > 0
        ? `${formatLength(leftToPlace, "short", format)} left to place`
        : "All placed",
    detail: `across ${activities}${overBudget > 0 ? ` · ${String(overBudget)} over budget` : ""}`,
  };
}
