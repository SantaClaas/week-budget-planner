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

/** The plan's activities' ids, in their order. */
const listIds = (moved: Plan): string[] => moved.activities.map((activity) => activity.id);

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

  it("compares every field of an activity", () => {
    // update() compares these by name. If Activity gains a field, add it there, then here.
    expect(Object.keys(work).toSorted()).toEqual(
      ["budgetMinutes", "days", "hue", "id", "mode", "name", "shape"].toSorted(),
    );
    for (const changes of [
      { name: createActivity({ name: "Office" }).name },
      { hue: 255 as const },
      { shape: "heart" as const },
      { mode: "day" as const },
      { budgetMinutes: createActivity({ budgetMinutes: 600 }).budgetMinutes },
      { days: createActivity({ days: 3 }).days },
    ]) {
      const { id: _, ...rest } = work;
      expect(list.update(plan, work.id, { ...rest, ...changes })).not.toBe(plan);
    }
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
    expect(list.remove(plan, createActivityId("gone")).plan).toBe(plan);
  });

  it("moves an activity to another place, the others keeping their order", () => {
    const lecture = createActivity({ id: "lecture", name: "Lecture" });
    const three: Plan = { ...plan, activities: [work, gym, lecture] };
    expect(listIds(list.move(three, lecture.id, 0))).toEqual(["lecture", "work", "gym"]);
    expect(listIds(list.move(three, work.id, 2))).toEqual(["gym", "lecture", "work"]);
    expect(listIds(list.move(three, work.id, 1))).toEqual(["gym", "work", "lecture"]);
    // Past either end, it goes to that end.
    expect(listIds(list.move(three, gym.id, 9))).toEqual(["work", "lecture", "gym"]);
    expect(listIds(list.move(three, gym.id, -1))).toEqual(["gym", "work", "lecture"]);
    expect(list.move(three, lecture.id, 0).blocks).toBe(three.blocks);
  });

  it("gives back the same plan when an activity moves to where it is, or doesn't exist", () => {
    expect(list.move(plan, gym.id, 1)).toBe(plan);
    // An index past the end means the end, where the last activity already is.
    expect(list.move(plan, gym.id, 9)).toBe(plan);
    expect(list.move(plan, createActivityId("none"), 0)).toBe(plan);
  });
});
