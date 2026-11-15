// Every case of "Conflicts, case by case" in docs/spec/merge.md: two devices act without knowing of
// each other, then each merges the other's change.
import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../plan/index.ts";
import * as activityList from "../plan/activity/list.ts";
import type { Activity } from "../plan/activity/index.ts";
import { sanitizePlan } from "../plan/sanitize.ts";
import { createActivity, createBlock, createPredictableIds } from "../plan/test-data.ts";
import { sanitizeBudgetMinutes, sanitizeDayEnd, sanitizeDayStart } from "../plan/time.ts";
import { convertPlan, readPlan, takeSnapshot } from "./index.ts";
import { act, createNode, receive, type Node } from "./test-data.ts";

const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", hue: 152, shape: "arch" });
const yoga = createActivity({ id: "yoga", name: "Yoga", hue: 305, shape: "heart" });
const read = createActivity({ id: "read", name: "Read", hue: 198, shape: "pill" });
const plan: Plan = {
  ...createEmptyPlan(),
  activities: [work, gym, yoga, read],
  blocks: [
    createBlock({ id: "1", activityId: "work" }),
    createBlock({ id: "2", activityId: "gym", day: 2 }),
  ],
};

type Action = (shown: Plan) => Plan;

/** Two nodes that start from the same plan. */
const createPair = (start: Plan = plan): [Node, Node] => [
  createNode("laptop", convertPlan(start)),
  createNode("phone", convertPlan(start)),
];

/**
 * The laptop does `first` and the phone `second`, without knowing of each other, the phone's
 * wall clock a second later. Then each merges the other's change. Both must show the same plan.
 */
function runApart(
  first: Action,
  second: Action,
  start: Plan = plan,
): { plan: Plan; nodes: [Node, Node] } {
  const nodes = createPair(start);
  const [laptop, phone] = nodes;
  const fromLaptop = act(laptop, 1_763_200_000_000, first);
  const fromPhone = act(phone, 1_763_200_001_000, second);
  receive(laptop, fromPhone);
  receive(phone, fromLaptop);
  expect(takeSnapshot(laptop.rows)).toEqual(takeSnapshot(phone.rows));
  const shown = readPlan(laptop.rows);
  expect(sanitizePlan(shown, createPredictableIds())).toEqual(shown);
  return { plan: shown, nodes };
}

const change =
  (id: Activity["id"], values: Partial<Omit<Activity, "id">>): Action =>
  (shown) => {
    const activity = shown.activities.find((each) => each.id === id);
    if (activity === undefined) throw new Error(`No activity ${id}.`);
    const { id: _, ...rest } = activity;
    return activityList.update(shown, id, { ...rest, ...values });
  };

const changeBlock =
  (id: string, values: { day?: number; start?: number; length?: number }): Action =>
  (shown) => ({
    ...shown,
    blocks: shown.blocks.map((block) => {
      if (block.id !== id) return block;
      const changed = createBlock({ ...block, ...values });
      return { ...block, day: changed.day, start: changed.start, length: changed.length };
    }),
  });

const removeBlock =
  (id: string): Action =>
  (shown) => ({ ...shown, blocks: shown.blocks.filter((block) => block.id !== id) });

const named = (name: string): Activity["name"] => createActivity({ name }).name;
const findActivity = (shown: Plan, id: string): Activity | undefined =>
  shown.activities.find((activity) => activity.id === id);

const findBlockOne = (shown: Plan) => shown.blocks.find((each) => each.id === "1");
const removeGym: Action = (shown) => activityList.remove(shown, gym.id).plan;
const addGymBlock: Action = (shown) => ({
  ...shown,
  blocks: [...shown.blocks, createBlock({ id: "3", activityId: "gym", day: 5 })],
});
const keepExample: Action = (shown) => ({ ...shown, exampleLoadedAt: null });
const startEmpty: Action = (shown) => ({ ...createEmptyPlan(), dayStart: shown.dayStart });
/** Adds an activity named Gym with the id `activityId`, a block of it and one of work. */
const addOn =
  (activityId: string, blockId: string): Action =>
  (shown) => ({
    ...activityList.add(shown, createActivity({ id: activityId, name: "Gym" })),
    blocks: [
      ...shown.blocks,
      createBlock({ id: blockId, activityId, day: 6 }),
      createBlock({ id: `${blockId}-work`, activityId: "work", day: 5 }),
    ],
  });

describe("conflicts, case by case", () => {
  it("rename the same activity: the later name", () => {
    const merged = runApart(
      change(gym.id, { name: named("Climbing") }),
      change(gym.id, { name: named("Boulder") }),
    );
    expect(findActivity(merged.plan, "gym")?.name).toBe("Boulder");
  });

  it("rename an activity, and change its budget: both", () => {
    const budgetMinutes = sanitizeBudgetMinutes(300, "week");
    const merged = runApart(
      change(gym.id, { name: named("Climbing") }),
      change(gym.id, { budgetMinutes }),
    );
    expect(findActivity(merged.plan, "gym")).toMatchObject({
      name: "Climbing",
      budgetMinutes: 300,
    });
  });

  it("change an activity's budget from per week to per day, and change its hours: the later budget, whole", () => {
    const toDay = change(work.id, {
      mode: "day",
      budgetMinutes: sanitizeBudgetMinutes(120, "day"),
    });
    const hours = change(work.id, { budgetMinutes: sanitizeBudgetMinutes(2400, "week") });
    expect(findActivity(runApart(toDay, hours).plan, "work")).toMatchObject({
      mode: "week",
      budgetMinutes: 2400,
    });
    expect(findActivity(runApart(hours, toDay).plan, "work")).toMatchObject({
      mode: "day",
      budgetMinutes: 120,
    });
  });

  it("move a block, and resize the same block: the block as the later one left it", () => {
    const move = changeBlock("1", { day: 4, start: 480 });
    const resize = changeBlock("1", { length: 240 });
    expect(findBlockOne(runApart(move, resize).plan)).toMatchObject({
      day: 0,
      start: 600,
      length: 240,
    });
    expect(findBlockOne(runApart(resize, move).plan)).toMatchObject({
      day: 4,
      start: 480,
      length: 90,
    });
  });

  it("delete a block, and move it: deleted", () => {
    const move = changeBlock("1", { day: 4 });
    expect(runApart(removeBlock("1"), move).plan.blocks.map((block) => block.id)).toEqual(["2"]);
    expect(runApart(move, removeBlock("1")).plan.blocks.map((block) => block.id)).toEqual(["2"]);
  });

  it("delete an activity, and add a block of it: both gone; undoing the deletion brings back both", () => {
    const merged = runApart(removeGym, addGymBlock);
    expect(findActivity(merged.plan, "gym")).toBeUndefined();
    expect(merged.plan.blocks.map((block) => block.id)).toEqual(["1"]);
    // The laptop undoes its deletion: the plan before it, applied to the plan as it is now.
    const [laptop, phone] = merged.nodes;
    const undo = act(laptop, 1_763_200_002_000, (shown) => ({
      ...shown,
      activities: plan.activities,
      blocks: [...shown.blocks, ...plan.blocks.filter((block) => block.activityId === gym.id)],
    }));
    receive(phone, undo);
    const back = readPlan(phone.rows);
    expect(findActivity(back, "gym")).toEqual(gym);
    expect(back.blocks.map((block) => block.id)).toEqual(["1", "2", "3"]);
    expect(takeSnapshot(phone.rows)).toEqual(takeSnapshot(laptop.rows));
  });

  it("delete an activity, and rename it: deleted", () => {
    const rename = change(gym.id, { name: named("Climbing") });
    expect(findActivity(runApart(removeGym, rename).plan, "gym")).toBeUndefined();
    expect(findActivity(runApart(rename, removeGym).plan, "gym")).toBeUndefined();
  });

  it("reorder different activities: both moves", () => {
    const merged = runApart(
      (shown) => activityList.move(shown, yoga.id, 0),
      (shown) => activityList.move(shown, read.id, 1),
    );
    expect(merged.plan.activities.map((activity) => activity.id)).toEqual([
      "yoga",
      "work",
      "read",
      "gym",
    ]);
  });

  it("set the start of the day hours, and the end: both", () => {
    const merged = runApart(
      (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }),
      (shown) => ({ ...shown, dayEnd: sanitizeDayEnd(23) }),
    );
    expect(merged.plan).toMatchObject({ dayStart: 6, dayEnd: 23 });
  });

  it("both set the start of the day hours: the later", () => {
    const merged = runApart(
      (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }),
      (shown) => ({ ...shown, dayStart: sanitizeDayStart(9) }),
    );
    expect(merged.plan.dayStart).toBe(9);
  });

  it("keep the example week, and start empty: empty, since starting empty deletes the rows", () => {
    const example = { ...plan, exampleLoadedAt: "2026-11-15T10:00:00Z" };
    const empty = { activities: [], blocks: [], exampleLoadedAt: null };
    expect(runApart(keepExample, startEmpty, example).plan).toMatchObject(empty);
    expect(runApart(startEmpty, keepExample, example).plan).toMatchObject(empty);
  });

  it("add activities or blocks: all of them; nothing is matched by name", () => {
    const merged = runApart(addOn("gym-laptop", "laptop"), addOn("gym-phone", "phone"));
    expect(merged.plan.activities.filter((activity) => activity.name === "Gym")).toHaveLength(3);
    expect(merged.plan.blocks.map((block) => block.id)).toEqual([
      "1",
      "2",
      "laptop",
      "laptop-work",
      "phone",
      "phone-work",
    ]);
  });
});
