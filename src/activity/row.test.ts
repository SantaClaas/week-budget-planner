import { describe, expect, it } from "vitest";

import { createActivity, createBlock } from "../plan/test-data.ts";
import { describeOverview, listRows } from "./row.ts";

const format = { locale: "en" };
const lecture = createActivity({ id: "lecture", name: "Lecture", budgetMinutes: 180 });
const gym = createActivity({ id: "gym", name: "Gym", mode: "day", budgetMinutes: 90, days: 3 });
const work = createActivity({ id: "work", name: "Work", budgetMinutes: 720 });
const plan = {
  activities: [lecture, gym, work],
  blocks: [
    createBlock({ id: "1", activityId: "lecture", length: 180 }),
    createBlock({ id: "2", activityId: "gym", length: 90 }),
    createBlock({ id: "3", activityId: "work", length: 750 }),
  ],
};

describe("activity rows", () => {
  it("says what's left to place, all placed or over budget", () => {
    const [lectureRow, gymRow, workRow] = listRows(plan, format);
    expect(lectureRow).toMatchObject({
      budget: "3 hr per week",
      state: "all-placed",
      figure: "All placed",
      caption: "3 hr",
      weeklyBudget: 180,
      placedMinutes: 180,
      placed: "3 hr placed",
    });
    expect(gymRow).toMatchObject({
      budget: "1 hr, 30 min per day, 3 days",
      state: "left",
      figure: "3 hr",
      caption: "left to place",
    });
    expect(workRow).toMatchObject({
      state: "over-budget",
      figure: "30 min",
      caption: "over budget",
      weeklyBudget: 720,
      placedMinutes: 750,
    });
  });

  it("says one day in the singular", () => {
    const daily = createActivity({ mode: "day", budgetMinutes: 60, days: 1 });
    expect(listRows({ activities: [daily], blocks: [] }, format)[0]?.budget).toBe(
      "1 hr per day, 1 day",
    );
  });

  it("sums up the list", () => {
    expect(describeOverview(plan, format)).toEqual({
      leftToPlace: "3 hr left to place",
      detail: "across 3 activities · 1 over budget",
    });
    expect(describeOverview({ activities: [lecture], blocks: plan.blocks }, format)).toEqual({
      leftToPlace: "All placed",
      detail: "across 1 activity",
    });
  });
});
