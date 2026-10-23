import { describe, expect, it } from "vitest";

import { sumPlacedByActivity, splitProgress, summarize, calculateWeeklyBudget } from "./budget.ts";
import { activityId, activity, block } from "./test-data.ts";

describe("budget", () => {
  it("counts per-day budgets times their days", () => {
    expect(calculateWeeklyBudget(activity({ mode: "day", budgetMinutes: 90, days: 3 }))).toBe(270);
    expect(calculateWeeklyBudget(activity({ mode: "week", budgetMinutes: 720 }))).toBe(720);
  });

  it("sums placed time and over budget", () => {
    const work = activity();
    const gym = activity({ id: "g", mode: "day", budgetMinutes: 90, days: 3 });
    const blocks = [
      block({ id: "1", length: 750 }),
      block({ id: "2", activityId: "g", length: 90 }),
    ];
    expect(sumPlacedByActivity(blocks).get(activityId("a"))).toBe(750);
    expect(summarize({ activities: [work, gym], blocks })).toEqual({
      budget: 990,
      placed: 840,
      leftToPlace: 180,
      overBudget: 30,
    });
  });

  it("splits the progress bar at the budget when over", () => {
    expect(splitProgress(720, 360)).toEqual({ withinBudget: 0.5, overBudget: 0 });
    expect(splitProgress(720, 720)).toEqual({ withinBudget: 1, overBudget: 0 });
    const overBudget = splitProgress(720, 750);
    expect(overBudget.withinBudget).toBeCloseTo(0.96);
    expect(overBudget.overBudget).toBeCloseTo(0.04);
  });
});
