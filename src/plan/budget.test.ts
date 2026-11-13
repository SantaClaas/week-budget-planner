import { describe, expect, it } from "vitest";

import {
  calculateWeeklyBudget,
  readPlaced,
  splitProgress,
  summarize,
  sumPlacedByActivity,
} from "./budget.ts";
import { createActivityId, createActivity, createBlock } from "./test-data.ts";
import { sanitizePlaced, sanitizeTotalBudget, sanitizeWeeklyBudget } from "./time.ts";

describe("budget", () => {
  it("counts per-day budgets times their days", () => {
    expect(calculateWeeklyBudget(createActivity({ mode: "day", budgetMinutes: 90, days: 3 }))).toBe(
      270,
    );
    expect(calculateWeeklyBudget(createActivity({ mode: "week", budgetMinutes: 720 }))).toBe(720);
  });

  it("sums placed time and over budget", () => {
    const work = createActivity();
    const gym = createActivity({ id: "g", mode: "day", budgetMinutes: 90, days: 3 });
    const blocks = [
      createBlock({ id: "1", length: 750 }),
      createBlock({ id: "2", activityId: "g", length: 90 }),
    ];
    expect(sumPlacedByActivity(blocks).get(createActivityId("a"))).toBe(750);
    // An activity without blocks has nothing placed.
    expect(readPlaced(sumPlacedByActivity(blocks), createActivityId("none"))).toBe(0);
    expect(summarize({ activities: [work, gym], blocks })).toEqual({
      budget: 990,
      placed: 840,
      leftToPlace: 180,
      overBudget: 30,
    });
  });

  it("splits the progress bar at the budget when over", () => {
    const twelveHours = sanitizeWeeklyBudget(720);
    expect(splitProgress(twelveHours, sanitizePlaced(360))).toEqual({
      withinBudget: 0.5,
      overBudget: 0,
    });
    expect(splitProgress(twelveHours, sanitizePlaced(720))).toEqual({
      withinBudget: 1,
      overBudget: 0,
    });
    const overBudget = splitProgress(twelveHours, sanitizePlaced(750));
    expect(overBudget.withinBudget).toBeCloseTo(0.96);
    expect(overBudget.overBudget).toBeCloseTo(0.04);
  });

  it("splits the progress bar without a budget: empty, or all over budget once something is placed", () => {
    const noBudget = sanitizeTotalBudget(0);
    expect(splitProgress(noBudget, sanitizePlaced(0))).toEqual({ withinBudget: 0, overBudget: 0 });
    expect(splitProgress(noBudget, sanitizePlaced(60))).toEqual({ withinBudget: 0, overBudget: 1 });
  });
});
