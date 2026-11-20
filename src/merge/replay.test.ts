import { describe, expect, it } from "vitest";

import * as activityList from "../plan/activity/list.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createActivity, createActivityId, createBlock } from "../plan/test-data.ts";
import { sanitizeDayEnd, sanitizeDayStart } from "../plan/time.ts";
import { replay } from "./replay.ts";

const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", hue: 152, shape: "arch" });
const read = createActivity({ id: "read", name: "Read" });
const plan: Plan = {
  ...createEmptyPlan(),
  activities: [work, gym, read],
  blocks: [
    createBlock({ id: "1", activityId: "work" }),
    createBlock({ id: "2", activityId: "gym", day: 2 }),
  ],
};

const listIds = (shown: Plan): string[] => shown.activities.map((activity) => activity.id);
const setDayStart = (shown: Plan): Plan => ({ ...shown, dayStart: sanitizeDayStart(9) });
const rename = (shown: Plan, id: string, name: string): Plan =>
  activityList.update(shown, createActivityId(id), {
    ...(shown.activities.find((activity) => activity.id === id) ?? work),
    name: createActivity({ name }).name,
  });

describe("replaying an action on a plan that changed since", () => {
  it("gives back the plan after where nothing changed since", () => {
    const after = rename(plan, "work", "Job");
    expect(replay(plan, plan, after)).toBe(after);
  });

  it("keeps a change made since to another field of the same activity", () => {
    const now = { ...plan, activities: [{ ...work, hue: 305 as const }, gym, read] };
    const replayed = replay(now, plan, rename(plan, "work", "Job"));
    expect(replayed.activities[0]).toMatchObject({ name: "Job", hue: 305 });
  });

  it("keeps a rename made since when the action only moved a block", () => {
    const now = rename(plan, "work", "Renamed");
    const [first, ...rest] = plan.blocks;
    const resized = {
      ...plan,
      blocks: [createBlock({ ...first, activityId: "work", length: 120 }), ...rest],
    };
    const replayed = replay(now, plan, resized);
    expect(replayed.activities[0]?.name).toBe("Renamed");
    expect(replayed.blocks.find((block) => block.id === "1")?.length).toBe(120);
  });

  it("gives the action's value to a field changed both since and by the action", () => {
    const replayed = replay(rename(plan, "work", "Since"), plan, rename(plan, "work", "Action"));
    expect(replayed.activities[0]?.name).toBe("Action");
  });

  it("keeps an activity deleted since deleted, with what the action changed in it", () => {
    const now = activityList.remove(plan, gym.id).plan;
    const replayed = replay(now, plan, rename(plan, "gym", "Climbing"));
    expect(listIds(replayed)).toEqual(["work", "read"]);
    expect(replayed.blocks.map((block) => block.id)).toEqual(["1"]);
  });

  it("keeps an activity added since, and removes the one the action removed", () => {
    const yoga = createActivity({ id: "yoga", name: "Yoga" });
    const now = activityList.add(plan, yoga);
    const replayed = replay(now, plan, activityList.remove(plan, gym.id).plan);
    expect(listIds(replayed)).toEqual(["work", "read", "yoga"]);
    expect(replayed.blocks.map((block) => block.id)).toEqual(["1"]);
  });

  it("adds what the action added after the activity it followed", () => {
    const yoga = createActivity({ id: "yoga", name: "Yoga" });
    const swim = createActivity({ id: "swim", name: "Swim" });
    const now = activityList.add(plan, swim);
    const after = activityList.move(activityList.add(plan, yoga), yoga.id, 1);
    expect(listIds(replay(now, plan, after))).toEqual(["work", "yoga", "gym", "read", "swim"]);
  });

  it("reorders as the action did, in the places the activities hold now", () => {
    const swim = createActivity({ id: "swim", name: "Swim" });
    const now = activityList.move(activityList.add(plan, swim), swim.id, 1);
    const after = activityList.move(plan, read.id, 0);
    expect(listIds(replay(now, plan, after))).toEqual(["read", "swim", "work", "gym"]);
  });

  it("drops a block added since to an activity the action removed", () => {
    const now = { ...plan, blocks: [...plan.blocks, createBlock({ id: "3", activityId: "gym" })] };
    const replayed = replay(now, plan, activityList.remove(plan, gym.id).plan);
    expect(replayed.blocks.map((block) => block.id)).toEqual(["1"]);
  });

  it("sets the day hours the action set, and keeps the end set since", () => {
    const now = { ...plan, dayEnd: sanitizeDayEnd(20) };
    const replayed = replay(now, plan, { ...plan, dayStart: sanitizeDayStart(9) });
    expect(replayed).toMatchObject({ dayStart: 9, dayEnd: 20 });
  });

  describe.each([
    ["the name", { name: createActivity({ name: "Changed" }).name }],
    ["the hue", { hue: 305 as const }],
    ["the shape", { shape: "heart" as const }],
    ["the mode", { mode: "day" as const, budgetMinutes: work.budgetMinutes, days: work.days }],
    ["the minutes", { budgetMinutes: createActivity({ budgetMinutes: 60 }).budgetMinutes }],
    ["the days", { days: createActivity({ days: 2 }).days }],
  ])("%s of an activity", (_, changed) => {
    const changedPlan = activityList.update(plan, work.id, { ...work, ...changed });

    it("keeps a change made since that the action didn't make", () => {
      const replayed = replay(changedPlan, plan, setDayStart(plan));
      expect(replayed.activities[0]).toEqual({ ...work, ...changed });
    });

    it("takes the action's change over the value now", () => {
      const now = activityList.update(plan, work.id, { ...work, hue: 350 });
      const replayed = replay(now, plan, changedPlan);
      expect(replayed.activities[0]).toMatchObject(changed);
    });
  });

  it.each([
    ["day", { day: 5 }],
    ["start", { start: 840 }],
    ["length", { length: 240 }],
  ])("keeps a block's %s moved since, and takes the action's move", (_, changed) => {
    const [first, ...rest] = plan.blocks;
    const moved = {
      ...plan,
      blocks: [createBlock({ ...first, activityId: "work", ...changed }), ...rest],
    };
    const otherAction = { ...plan, dayStart: sanitizeDayStart(9) };
    expect(replay(moved, plan, otherAction).blocks[0]).toEqual(moved.blocks[0]);
    expect(replay(otherAction, plan, moved).blocks[0]).toEqual(moved.blocks[0]);
  });

  it("keeps a block added since, and the one the action added, once each", () => {
    const sinceBlock = createBlock({ id: "since", activityId: "read" });
    const actionBlock = createBlock({ id: "action", activityId: "read" });
    const now = { ...plan, blocks: [...plan.blocks, sinceBlock, actionBlock] };
    const after = { ...plan, blocks: [...plan.blocks, actionBlock] };
    expect(replay(now, plan, after).blocks.map((block) => block.id)).toEqual([
      "1",
      "2",
      "since",
      "action",
    ]);
  });

  it("removes the block the action removed, and keeps the others", () => {
    const after = { ...plan, blocks: plan.blocks.slice(1) };
    const now = { ...plan, dayEnd: sanitizeDayEnd(20) };
    expect(replay(now, plan, after).blocks.map((block) => block.id)).toEqual(["2"]);
  });

  it("adds an activity the action added once, also where it's already there", () => {
    const yoga = createActivity({ id: "yoga", name: "Yoga" });
    const now = activityList.add(plan, yoga);
    const after = activityList.add(plan, { ...yoga, name: createActivity({ name: "Yin" }).name });
    const replayed = replay(now, plan, after);
    expect(listIds(replayed)).toEqual(["work", "gym", "read", "yoga"]);
    expect(replayed.activities[3]?.name).toBe("Yin");
  });

  it("keeps the order now where the action didn't reorder, also with an activity deleted since", () => {
    const now = activityList.move(activityList.remove(plan, gym.id).plan, read.id, 0);
    expect(listIds(replay(now, plan, rename(plan, "work", "Job")))).toEqual(["read", "work"]);
  });

  it("reorders when the action moved only later activities", () => {
    const now = rename(plan, "work", "Job");
    const after = activityList.move(plan, read.id, 1);
    expect(listIds(replay(now, plan, after))).toEqual(["work", "read", "gym"]);
  });

  it("reorders around an activity deleted since", () => {
    const now = activityList.remove(plan, gym.id).plan;
    const after = activityList.move(plan, read.id, 0);
    expect(listIds(replay(now, plan, after))).toEqual(["read", "work"]);
  });

  it("puts an activity the action added after the nearest activity before it that's there", () => {
    const yoga = createActivity({ id: "yoga", name: "Yoga" });
    const now = activityList.remove(plan, gym.id).plan;
    const after = activityList.move(activityList.add(plan, yoga), yoga.id, 2);
    expect(listIds(replay(now, plan, after))).toEqual(["work", "yoga", "read"]);
  });

  it("puts an activity the action added first, when nothing it followed is there", () => {
    const yoga = createActivity({ id: "yoga", name: "Yoga" });
    const now = activityList.remove(plan, work.id).plan;
    const after = activityList.move(activityList.add(plan, yoga), yoga.id, 1);
    expect(listIds(replay(now, plan, after))).toEqual(["yoga", "gym", "read"]);
  });
});
