import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../plan/index.ts";
import * as activityList from "../plan/activity/list.ts";
import { createActivity, createBlock } from "../plan/test-data.ts";
import { sanitizeDayStart } from "../plan/time.ts";
import { make } from "./change.ts";
import { convertPlan, merge, readPlan, takeSnapshot, type Rows } from "./index.ts";
import { LOWEST } from "./stamp.ts";
import { createStamp, required } from "./test-data.ts";

const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", hue: 152, shape: "arch" });
const yoga = createActivity({ id: "yoga", name: "Yoga", hue: 305, shape: "heart" });
const plan: Plan = {
  ...createEmptyPlan(),
  activities: [work, gym, yoga],
  blocks: [
    createBlock({ id: "1", activityId: "work" }),
    createBlock({ id: "2", activityId: "gym" }),
    createBlock({ id: "3", activityId: "gym", day: 2 }),
  ],
};
const rows = convertPlan(plan);
const stamp = createStamp(1_763_200_000_000, 0, "me");

/** Makes the change from the plan the rows show to what `perform` turns it into. */
function act(held: Rows, perform: (shown: Plan) => Plan, at = stamp) {
  const before = readPlan(held);
  return make(held, before, perform(before), at);
}

/** Every register of a row with the stamp it has, by name. */
const listStamps = (row: object | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(row ?? {}).flatMap(([name, field]: [string, unknown]) =>
      typeof field === "object" && field !== null && "stamp" in field
        ? [[name, String(field.stamp)]]
        : [],
    ),
  );

/** The plan with the block `id` moved to midnight. */
const moveToMidnight = (shown: Plan, id: string): Plan => ({
  ...shown,
  blocks: shown.blocks.map((block) =>
    block.id === id ? { ...block, start: createBlock({ start: 0 }).start } : block,
  ),
});

describe("making a change", () => {
  it("changes nothing when the action changed nothing", () => {
    const made = act(rows, (shown) => shown);
    expect(made.change).toEqual({ version: 1, activities: [], blocks: [], settings: null });
    expect(takeSnapshot(made.rows)).toEqual(takeSnapshot(rows));
  });

  it("gives a new activity every register, and a key after the last", () => {
    const made = act(rows, (shown) =>
      activityList.add(shown, createActivity({ id: "read", name: "Read" })),
    );
    const [row] = made.change.activities;
    expect(made.change.activities).toHaveLength(1);
    expect(Object.values(listStamps(row))).toEqual(Array.from({ length: 6 }, () => stamp));
    expect(readPlan(made.rows).activities.map((activity) => activity.id)).toEqual([
      "work",
      "gym",
      "yoga",
      "read",
    ]);
  });

  it("stamps only the register a rename changed, and sends the row whole", () => {
    const made = act(rows, (shown) => {
      const { id: _, ...values } = gym;
      return activityList.update(shown, gym.id, {
        ...values,
        name: createActivity({ name: "Climbing" }).name,
      });
    });
    expect(made.change.activities).toHaveLength(1);
    expect(made.change.blocks).toEqual([]);
    expect(listStamps(made.change.activities[0])).toEqual({
      name: stamp,
      hue: LOWEST,
      shape: LOWEST,
      budget: LOWEST,
      order: LOWEST,
      existence: LOWEST,
    });
  });

  it("stamps the whole budget when one of its fields changed", () => {
    const made = act(rows, (shown) => {
      const { id: _, ...values } = work;
      return activityList.update(shown, work.id, {
        ...values,
        days: createActivity({ days: 3 }).days,
      });
    });
    expect(listStamps(made.change.activities[0])).toMatchObject({ budget: stamp, name: LOWEST });
  });

  it("leaves two equal order keys alone when the action doesn't change the order", () => {
    const workRow = required(rows.activities.get(work.id), "row for work");
    const gymRow = required(rows.activities.get(gym.id), "row for the gym");
    const tied: Rows = {
      ...rows,
      activities: new Map([...rows.activities, [gym.id, { ...gymRow, order: workRow.order }]]),
    };
    const made = act(tied, (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }));
    expect(made.change.activities).toEqual([]);
    const deleted = act(tied, (shown) => activityList.remove(shown, yoga.id).plan);
    expect(deleted.change.activities.map((row) => row.id)).toEqual(["yoga"]);
  });

  it("gives one activity moved in the list the only new order key", () => {
    const made = act(rows, (shown) => activityList.move(shown, yoga.id, 0));
    expect(made.change.activities.map((row) => row.id)).toEqual(["yoga"]);
    expect(listStamps(made.change.activities[0])).toMatchObject({ order: stamp, name: LOWEST });
    expect(readPlan(made.rows).activities.map((activity) => activity.id)).toEqual([
      "yoga",
      "work",
      "gym",
    ]);
  });

  it("marks a deleted activity and its blocks deleted, without removing their rows", () => {
    const made = act(rows, (shown) => activityList.remove(shown, gym.id).plan);
    expect(made.change.activities.map((row) => row.id)).toEqual(["gym"]);
    expect(made.change.activities[0]?.existence).toEqual({ value: { isDeleted: true }, stamp });
    expect(made.change.blocks.map((row) => [row.id, row.existence.value.isDeleted])).toEqual([
      ["2", true],
      ["3", true],
    ]);
    expect(made.rows.activities.size).toBe(3);
    expect(made.rows.blocks.size).toBe(3);
    expect(readPlan(made.rows).activities.map((activity) => activity.id)).toEqual(["work", "yoga"]);
  });

  it("writes the existence again when a deleted activity comes back, and nothing else", () => {
    const deleted = act(rows, (shown) => activityList.remove(shown, gym.id).plan);
    const later = createStamp(1_763_200_000_001, 0, "me");
    const undone = act(deleted.rows, () => plan, later);
    const [row] = undone.change.activities;
    expect(listStamps(row)).toEqual({
      name: LOWEST,
      hue: LOWEST,
      shape: LOWEST,
      budget: LOWEST,
      order: LOWEST,
      existence: later,
    });
    expect(undone.change.blocks.map((block) => listStamps(block))).toEqual([
      { time: LOWEST, existence: later },
      { time: LOWEST, existence: later },
    ]);
    expect(readPlan(undone.rows)).toEqual(readPlan(rows));
  });

  it("writes the values of the plan after for an activity that comes back changed", () => {
    const deleted = act(rows, (shown) => activityList.remove(shown, gym.id).plan);
    const later = createStamp(1_763_200_000_001, 0, "me");
    const renamed = { ...gym, name: createActivity({ name: "Climbing" }).name };
    const back = act(deleted.rows, (shown) => activityList.add(shown, renamed), later);
    expect(listStamps(back.change.activities[0])).toMatchObject({
      name: later,
      hue: LOWEST,
      existence: later,
    });
  });

  it("stamps a moved block's time, and sends its activity's row with it", () => {
    const made = act(rows, (shown) => moveToMidnight(shown, "1"));
    expect(made.change.blocks.map((block) => listStamps(block))).toEqual([
      { time: stamp, existence: LOWEST },
    ]);
    expect(made.change.activities.map((row) => row.id)).toEqual(["work"]);
    expect(Object.values(listStamps(made.change.activities[0]))).not.toContain(stamp);
  });

  it("gives a new block both registers", () => {
    const made = act(rows, (shown) => ({
      ...shown,
      blocks: [...shown.blocks, createBlock({ id: "4", activityId: "yoga" })],
    }));
    expect(made.change.blocks.map((block) => listStamps(block))).toEqual([
      { time: stamp, existence: stamp },
    ]);
    expect(made.change.blocks[0]?.existence.value).toEqual({
      activityId: "yoga",
      isDeleted: false,
    });
    expect(made.change.activities.map((row) => row.id)).toEqual(["yoga"]);
  });

  it("stamps only the settings that changed, and sends no activities", () => {
    const made = act(rows, (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }));
    expect(made.change.activities).toEqual([]);
    expect(listStamps(required(made.change.settings, "settings"))).toEqual({
      dayStart: stamp,
      dayEnd: LOWEST,
      exampleLoadedAt: LOWEST,
    });
  });

  it("gives back the rows its change merges into", () => {
    const made = act(rows, (shown) => ({
      ...activityList.move(activityList.remove(shown, work.id).plan, yoga.id, 0),
      exampleLoadedAt: "2026-11-15T10:00:00Z",
    }));
    expect(takeSnapshot(made.rows)).toEqual(takeSnapshot(merge(rows, made.change)));
  });

  it("refuses a block whose activity has no row", () => {
    const empty = convertPlan(createEmptyPlan());
    const after = { ...plan, activities: [], blocks: [createBlock()] };
    expect(() => make(empty, readPlan(empty), after, stamp)).toThrow(/no|Missing/u);
  });
});
