import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../index.ts";
import { createActivity, createActivityId, createBlock } from "../test-data.ts";
import * as list from "./list.ts";

const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", hue: 152, shape: "arch" });
const plan: Plan = {
  ...createEmptyPlan(),
  activities: [work, gym],
  blocks: [
    createBlock({ id: "1", activityId: "work" }),
    createBlock({ id: "2", activityId: "gym" }),
    createBlock({ id: "3", activityId: "gym", day: 2 }),
  ],
};

describe("activity list", () => {
  it("adds an activity at the end", () => {
    const yoga = createActivity({ id: "yoga", name: "Yoga" });
    expect(list.add(plan, yoga).activities).toEqual([work, gym, yoga]);
    expect(plan.activities).toEqual([work, gym]);
  });

  it("changes an activity in its place", () => {
    const { id: _, ...changes } = createActivity({ id: "gym", name: "Climbing" });
    const changed = list.update(plan, gym.id, changes);
    expect(changed.activities.map((activity) => activity.name)).toEqual(["Work", "Climbing"]);
    expect(changed.activities[1]?.id).toBe("gym");
    expect(changed.blocks).toBe(plan.blocks);
  });

  it("gives back the same plan when nothing changes", () => {
    const { id: _, ...unchanged } = gym;
    expect(list.update(plan, gym.id, unchanged)).toBe(plan);
    expect(list.update(plan, createActivityId("gone"), unchanged)).toBe(plan);
  });

  it("removes an activity with its blocks, and counts them", () => {
    const { plan: removed, removedBlocks } = list.remove(plan, gym.id);
    expect(removed.activities).toEqual([work]);
    expect(removed.blocks.map((block) => block.id)).toEqual(["1"]);
    expect(removedBlocks).toBe(2);
    expect(list.remove(plan, createActivityId("gone"))).toEqual({ plan, removedBlocks: 0 });
  });
});
