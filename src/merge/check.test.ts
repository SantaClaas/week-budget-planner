import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { sanitizePlan } from "../plan/sanitize.ts";
import { createPredictableIds } from "../plan/test-data.ts";
import { parse, type Problem } from "./check.ts";
import { convertPlan, takeSnapshot } from "./index.ts";
import { act, createNode } from "./test-data.ts";

const example = sanitizePlan(exampleWeek, createPredictableIds());
const node = createNode("me", convertPlan(example));
// One action, so the snapshot holds real stamps as well as the lowest.
void act(node, 1_763_200_000_000, (plan) => ({
  ...plan,
  exampleLoadedAt: "2026-11-15T10:00:00Z",
  activities: plan.activities.toReversed(),
  blocks: plan.blocks.slice(1),
}));
const valid = JSON.stringify(takeSnapshot(node.rows));

type Container = Record<string | number, unknown>;
const isContainer = (value: unknown): value is Container =>
  typeof value === "object" && value !== null;

/** The snapshot as JSON would arrive, with the value at `path` replaced, or removed if undefined. */
function createReceived(path: readonly (string | number)[], value?: unknown): unknown {
  const received: unknown = JSON.parse(valid);
  let target = received;
  for (const step of path.slice(0, -1)) target = isContainer(target) ? target[step] : undefined;

  if (!isContainer(target)) throw new Error(`The snapshot has nothing at ${path.join(".")}.`);

  const last = path.at(-1) ?? "";
  if (value === undefined) {
    Reflect.deleteProperty(target, last);
    return received;
  }

  Reflect.set(target, last, value);
  return received;
}

/** The snapshot as JSON would arrive, with the first activity's name stamped under "at". */
function createWithRenamedStamp(): unknown {
  const received = createReceived(["activities", 0, "name", "stamp"]);
  const activities = isContainer(received) ? received["activities"] : undefined;
  const first: unknown = Array.isArray(activities) ? activities.at(0) : undefined;
  const name = isContainer(first) ? first["name"] : undefined;
  if (!isContainer(name)) throw new Error("The snapshot has no first activity.");

  name["at"] = "1763200000000-000003-me";
  return received;
}

/** The snapshot as JSON would arrive, with its first block twice. */
function createWithRepeatedBlock(): unknown {
  const received = createReceived([]);
  const blocks = isContainer(received) ? received["blocks"] : undefined;
  if (!Array.isArray(blocks)) throw new Error("The snapshot has no blocks.");

  blocks.push(blocks.at(0));
  return received;
}

/** The path to a field of the first activity in the snapshot. */
const findActivityField = (field: string, ...rest: string[]): (string | number)[] => [
  "activities",
  0,
  field,
  ...rest,
];
/** The path to a field of the first block in the snapshot. */
const findBlockField = (field: string, ...rest: string[]): (string | number)[] => [
  "blocks",
  0,
  field,
  ...rest,
];

describe("checking what is received", () => {
  it("accepts a snapshot as it was sent", () => {
    expect(parse(JSON.parse(valid))).toEqual(JSON.parse(valid));
  });

  it("accepts a change without settings", () => {
    const change = act(createNode("other", convertPlan(example)), 5, (plan) => ({
      ...plan,
      blocks: plan.blocks.slice(1),
    }));
    expect(change.settings).toBeNull();
    expect(parse(JSON.parse(JSON.stringify(change)))).toEqual(change);
  });

  it.each([
    [findActivityField("name", "value"), "x".repeat(60)],
    [findActivityField("name", "value"), "empty"],
    [findActivityField("budget", "value"), { mode: "week", budgetMinutes: 10_080, days: 7 }],
    [findActivityField("budget", "value"), { mode: "day", budgetMinutes: 1440, days: 1 }],
    [findActivityField("budget", "value"), { mode: "day", budgetMinutes: 15, days: 7 }],
    [findBlockField("time", "value"), { day: 6, start: 1425, length: 1440 }],
    [findBlockField("time", "value"), { day: 0, start: 0, length: 15 }],
    [["settings", "dayStart", "value"], 0],
    [["settings", "dayStart", "value"], 12],
    [["settings", "dayEnd", "value"], 13],
    [["settings", "dayEnd", "value"], 24],
    [["settings", "exampleLoadedAt", "value"], null],
    [["settings", "exampleLoadedAt", "value"], "2026-11-15T10:00:00.123Z"],
    [["settings"], null],
    [findBlockField("id"), "x".repeat(40)],
  ] as const)("accepts %j set to %j", (path, value) => {
    expect(typeof parse(createReceived(path, value))).toBe("object");
  });

  const refusals: [string, readonly (string | number)[], unknown, Problem][] = [
    ["a newer version", ["version"], 2, "newer-version"],
    ["an older or missing version", ["version"], 0, "not-a-change"],
    ["a version that isn't a number", ["version"], "1", "not-a-change"],
    ["a newer version written as text", ["version"], "2", "not-a-change"],
    ["an unknown field", ["extra"], true, "not-a-change"],
    ["a missing field", ["blocks"], undefined, "not-a-change"],
    ["a list that isn't one", ["activities"], {}, "not-a-change"],
    ["a row that isn't an object", ["activities", 0], "work", "not-a-change"],
    ["an unknown field in a row", findActivityField("color"), 255, "not-a-change"],
    ["a register without its stamp", findActivityField("name", "stamp"), undefined, "not-a-change"],
    ["an unknown field in a register", findActivityField("name", "at"), 1, "not-a-change"],
    [
      "a stamp out of form",
      findActivityField("hue", "stamp"),
      "1763200000000-3-me",
      "invalid-stamp",
    ],
    [
      "a stamp that isn't text",
      findBlockField("time", "stamp"),
      1_763_200_000_000,
      "invalid-stamp",
    ],
    ["an activity id too long", findActivityField("id"), "x".repeat(41), "invalid-id"],
    ["an empty activity id", findActivityField("id"), "", "invalid-id"],
    ["a block id that isn't text", findBlockField("id"), 7, "invalid-id"],
    ["an untrimmed name", findActivityField("name", "value"), " Work", "invalid-value"],
    ["an empty name", findActivityField("name", "value"), "", "invalid-value"],
    ["a name that isn't text", findActivityField("name", "value"), 5, "invalid-value"],
    ["a name too long", findActivityField("name", "value"), "x".repeat(61), "invalid-value"],
    ["a hue not in the palette", findActivityField("hue", "value"), 12, "invalid-value"],
    ["a shape not in the library", findActivityField("shape", "value"), "blob", "invalid-value"],
    ["an unknown mode", findActivityField("budget", "value", "mode"), "month", "invalid-value"],
    [
      "a budget off the slot",
      findActivityField("budget", "value", "budgetMinutes"),
      50,
      "invalid-value",
    ],
    [
      "a budget of nothing",
      findActivityField("budget", "value", "budgetMinutes"),
      0,
      "invalid-value",
    ],
    [
      "a budget that isn't a number",
      findActivityField("budget", "value", "budgetMinutes"),
      "60",
      "invalid-value",
    ],
    ["no days", findActivityField("budget", "value", "days"), 0, "invalid-value"],
    ["eight days", findActivityField("budget", "value", "days"), 8, "invalid-value"],
    ["part of a day", findActivityField("budget", "value", "days"), 1.5, "invalid-value"],
    [
      "a missing budget field",
      findActivityField("budget", "value", "days"),
      undefined,
      "invalid-value",
    ],
    ["an order key ending in zero", findActivityField("order", "value"), "V0", "invalid-order-key"],
    ["an empty order key", findActivityField("order", "value"), "", "invalid-order-key"],
    [
      "an existence that isn't a boolean",
      findActivityField("existence", "value", "isDeleted"),
      1,
      "invalid-value",
    ],
    [
      "an existence that isn't an object",
      findActivityField("existence", "value"),
      false,
      "invalid-value",
    ],
    ["a budget that isn't an object", findActivityField("budget", "value"), 60, "invalid-value"],
    ["a block's time that isn't an object", findBlockField("time", "value"), null, "invalid-value"],
    [
      "a block's existence that isn't an object",
      findBlockField("existence", "value"),
      "x",
      "invalid-value",
    ],
    ["a day start that isn't a number", ["settings", "dayStart", "value"], "7", "invalid-value"],
    ["a day after Sunday", findBlockField("time", "value", "day"), 7, "invalid-value"],
    ["a day before Monday", findBlockField("time", "value", "day"), -1, "invalid-value"],
    ["a start at midnight's end", findBlockField("time", "value", "start"), 1440, "invalid-value"],
    ["a start off the slot", findBlockField("time", "value", "start"), 607, "invalid-value"],
    [
      "a start that isn't a number",
      findBlockField("time", "value", "start"),
      null,
      "invalid-value",
    ],
    ["a length of nothing", findBlockField("time", "value", "length"), 0, "invalid-value"],
    ["a length over a day", findBlockField("time", "value", "length"), 1455, "invalid-value"],
    ["a length off the slot", findBlockField("time", "value", "length"), 50, "invalid-value"],
    [
      "a block's activity id too long",
      findBlockField("existence", "value", "activityId"),
      "x".repeat(41),
      "invalid-value",
    ],
    [
      "a block's existence that isn't a boolean",
      findBlockField("existence", "value", "isDeleted"),
      "no",
      "invalid-value",
    ],
    [
      "a block whose activity isn't there",
      findBlockField("existence", "value", "activityId"),
      "elsewhere",
      "missing-activity",
    ],
    ["a day start after noon", ["settings", "dayStart", "value"], 13, "invalid-value"],
    ["a day end before 13", ["settings", "dayEnd", "value"], 12, "invalid-value"],
    ["a day end that isn't whole", ["settings", "dayEnd", "value"], 22.5, "invalid-value"],
    [
      "a time not in UTC",
      ["settings", "exampleLoadedAt", "value"],
      "2026-10-15T22:30:00+02:00",
      "invalid-value",
    ],
    [
      "a time that isn't one",
      ["settings", "exampleLoadedAt", "value"],
      "yesterday",
      "invalid-value",
    ],
    ["a time that isn't text", ["settings", "exampleLoadedAt", "value"], 0, "invalid-value"],
    ["settings that aren't an object", ["settings"], "none", "not-a-change"],
    ["a block that isn't an object", ["blocks", 0], 7, "not-a-change"],
  ];

  for (const [what, path, value, problem] of refusals) {
    it(`refuses ${what}, whole`, () => {
      expect(parse(createReceived(path, value))).toBe(problem);
    });
  }

  it("refuses a register whose stamp has another name", () => {
    expect(parse(createWithRenamedStamp())).toBe("not-a-change");
  });

  it("refuses two rows with the same id", () => {
    expect(parse(createWithRepeatedBlock())).toBe("repeated-id");
  });

  it.each([null, undefined, "{}", 1, [], {}])(
    "refuses %j, which isn't a change at all",
    (value) => {
      expect(parse(value)).toBe("not-a-change");
    },
  );

  it("refuses a newer version before anything else", () => {
    expect(parse({ version: 3, rows: "whatever a later app sends" })).toBe("newer-version");
  });
});
