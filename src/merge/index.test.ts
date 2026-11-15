import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import type { Activity } from "../plan/activity/index.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { sanitizePlan } from "../plan/sanitize.ts";
import { sanitizeDayEnd } from "../plan/time.ts";
import { createActivity, createBlock, createPredictableIds } from "../plan/test-data.ts";
import { make } from "./change.ts";
import {
  convertPlan,
  findLatestStamp,
  merge,
  readPlan,
  takeSnapshot,
  type Change,
  type Rows,
} from "./index.ts";
import { formatCanonical, isSame, merge as mergeRegisters } from "./register.ts";
import { mergeActivity } from "./row.ts";
import { LOWEST } from "./stamp.ts";
import { createStamp, required } from "./test-data.ts";

const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", hue: 152, shape: "arch" });
const plan: Plan = {
  ...createEmptyPlan(),
  activities: [work, gym],
  blocks: [
    createBlock({ id: "2", activityId: "gym" }),
    createBlock({ id: "1", activityId: "work", day: 3 }),
  ],
};
const rows = convertPlan(plan);

/** The rows after `perform` changed the plan they show, stamped `stamp`. */
function change(held: Rows, stamp: string, perform: (shown: Plan) => Plan): Change {
  const before = readPlan(held);
  const [time = "0", counter = "0", node = "x"] = stamp.split("-");
  return make(held, before, perform(before), createStamp(Number(time), Number(counter), node))
    .change;
}

/** The plan with the work activity changed. */
const changeWork = (shown: Plan, values: Partial<Omit<Activity, "id">>): Plan => ({
  ...shown,
  activities: shown.activities.map((each) => (each.id === work.id ? { ...each, ...values } : each)),
});

const compareIds = (first: { id: string }, second: { id: string }): number =>
  first.id < second.id ? -1 : 1;

describe("register", () => {
  it("takes the later stamp", () => {
    const earlier = { value: "a", stamp: createStamp(1, 0, "a") };
    const later = { value: "b", stamp: createStamp(2, 0, "a") };
    expect(mergeRegisters(earlier, later)).toBe(later);
    expect(mergeRegisters(later, earlier)).toBe(later);
  });

  it("takes the value that sorts later as canonical JSON when the stamps are equal", () => {
    const stamp = createStamp(1, 0, "a");
    const first = { value: { b: 1, a: 2 }, stamp };
    const second = { value: { a: 3, b: 0 }, stamp };
    expect(mergeRegisters(first, second)).toBe(second);
    expect(mergeRegisters(second, first)).toBe(second);
  });

  it("keeps the first of two equal registers", () => {
    const first = { value: "a", stamp: LOWEST };
    expect(mergeRegisters(first, { value: "a", stamp: LOWEST })).toBe(first);
  });

  it("writes canonical JSON with every object's keys sorted", () => {
    expect(formatCanonical({ c: "x", a: 2, e: 1, b: false, d: null })).toBe(
      '{"a":2,"b":false,"c":"x","d":null,"e":1}',
    );
    expect(formatCanonical("Gym")).toBe('"Gym"');
    expect(formatCanonical(null)).toBe("null");
  });

  it("compares values field by field, whatever the order of their keys", () => {
    expect(isSame({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(isSame("a", "a")).toBe(true);
  });

  it.each([
    ["a", "b"],
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { a: 1, b: 2 }],
    [{ a: 1, b: 2 }, { a: 1 }],
    [{ a: 1 }, { b: 1 }],
    [{ a: null }, null],
    [null, { a: null }],
    [{ a: 1 }, '{"a":1}'],
    ['{"a":1}', { a: 1 }],
    [1, "1"],
    [1, 2],
    ["x", { 0: "x" }],
    [{ 0: "x" }, "x"],
  ])("tells %j from %j", (first, second) => {
    expect(isSame(first, second)).toBe(false);
  });
});

describe("rows", () => {
  it("keeps a row as the same object when merging changes nothing in it", () => {
    const row = required(rows.activities.get(work.id), "row for work");
    expect(mergeActivity(row, { ...row })).toBe(row);
    const merged = merge(rows, takeSnapshot(rows));
    expect(merged.activities.get(work.id)).toBe(row);
    expect(merged.settings).toBe(rows.settings);
  });

  it("merges in rows it didn't have", () => {
    const other = convertPlan({
      ...plan,
      activities: [createActivity({ id: "yoga" })],
      blocks: [],
    });
    const merged = merge(rows, takeSnapshot(other));
    expect(merged.activities.size).toBe(3);
  });

  it("merges the same whatever the order, and merging twice changes nothing", () => {
    const first = change(rows, "10-0-a", (shown) => ({ ...shown, dayEnd: sanitizeDayEnd(23) }));
    const rename = change(rows, "20-0-b", (shown) =>
      changeWork(shown, { name: createActivity({ name: "Office" }).name }),
    );
    const recolor = change(rows, "15-0-c", (shown) =>
      changeWork(shown, { hue: 305, name: createActivity({ name: "Desk" }).name }),
    );
    const orders = [
      [first, rename, recolor],
      [recolor, first, rename],
      [rename, recolor, first, rename, recolor],
    ];
    const snapshots = orders.map((each) =>
      takeSnapshot(each.reduce((held, next) => merge(held, next), rows)),
    );
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
    const shown = readPlan(merge(merge(merge(rows, first), rename), recolor));
    expect(shown.activities[0]).toMatchObject({ name: "Office", hue: 305 });
  });

  it("finds the latest stamp in a change", () => {
    const made = change(rows, "1763200000000-000004-n", (shown) => shown);
    expect(findLatestStamp(made)).toBe(LOWEST);
    const moved = change(rows, "1763200000000-000004-n", (shown) => ({
      ...shown,
      blocks: shown.blocks.map((block) => ({ ...block, day: createBlock({ day: 6 }).day })),
    }));
    expect(findLatestStamp(moved)).toBe("1763200000000-000004-n");
    expect(findLatestStamp(takeSnapshot(merge(rows, moved)))).toBe("1763200000000-000004-n");
  });
});

describe("snapshot", () => {
  it("holds every row, sorted by id", () => {
    const snapshot = takeSnapshot(rows);
    expect(snapshot.version).toBe(1);
    expect(snapshot.activities.map((row) => row.id)).toEqual(["gym", "work"]);
    expect(snapshot.blocks.map((row) => row.id)).toEqual(["1", "2"]);
    expect(snapshot.settings).toBe(rows.settings);
  });
});

describe("reading the plan", () => {
  it("shows a converted plan as it was, with its blocks by id", () => {
    expect(readPlan(rows)).toEqual({ ...plan, blocks: plan.blocks.toReversed() });
  });

  it("converts the example week with the lowest stamp everywhere, in the same order", () => {
    const example = sanitizePlan(exampleWeek, createPredictableIds());
    const converted = convertPlan(example);
    const shown = readPlan(converted);
    expect(shown.activities).toEqual(example.activities);
    expect(shown.blocks).toEqual(example.blocks.toSorted(compareIds));
    expect(findLatestStamp(takeSnapshot(converted))).toBe(LOWEST);
  });

  it("orders activities by key, and equal keys by id", () => {
    const workRow = required(rows.activities.get(work.id), "row for work");
    const gymRow = required(rows.activities.get(gym.id), "row for the gym");
    const sameKey = { ...gymRow, order: workRow.order };
    const shown = readPlan({
      ...rows,
      activities: new Map([
        [work.id, workRow],
        [gym.id, sameKey],
      ]),
    });
    expect(shown.activities.map((activity) => activity.id)).toEqual(["gym", "work"]);
  });

  it("leaves out deleted activities and their blocks, and deleted blocks", () => {
    const deleted = { value: { isDeleted: true }, stamp: createStamp(1, 0, "a") };
    const gymRow = required(rows.activities.get(gym.id), "row for the gym");
    const blockRow = required(rows.blocks.get(createBlock({ id: "1" }).id), "row for block 1");
    const withoutGym = readPlan({
      ...rows,
      activities: new Map([...rows.activities, [gym.id, { ...gymRow, existence: deleted }]]),
    });
    expect(withoutGym.activities.map((activity) => activity.id)).toEqual(["work"]);
    expect(withoutGym.blocks.map((block) => block.id)).toEqual(["1"]);
    const withoutBlock = readPlan({
      ...rows,
      blocks: new Map([
        ...rows.blocks,
        [
          blockRow.id,
          {
            ...blockRow,
            existence: { value: { ...blockRow.existence.value, isDeleted: true }, stamp: LOWEST },
          },
        ],
      ]),
    });
    expect(withoutBlock.blocks.map((block) => block.id)).toEqual(["2"]);
  });

  it("leaves out a block whose activity has no row", () => {
    const shown = readPlan({ ...rows, activities: new Map() });
    expect(shown.blocks).toEqual([]);
  });
});
