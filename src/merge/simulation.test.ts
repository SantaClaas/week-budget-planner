// Deterministic simulation (see Tests in docs/spec/merge.md): several nodes in one process, each
// with its own rows, clock and wall clock, and a seeded scheduler that makes random user actions on
// random nodes and delivers their changes late, twice, out of order, or not at all until a final
// exchange of snapshots. The same seed replays the same run: a failing run names its seed, and
// MERGE_SEED=<seed> pnpm test src/merge/simulation.test.ts runs that one alone.
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import type { Activity } from "../plan/activity/index.ts";
import * as activityList from "../plan/activity/list.ts";
import { DEFAULT_SHAPES, PALETTE } from "../plan/activity/look.ts";
import type { Block } from "../plan/block/index.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { sanitizePlan } from "../plan/sanitize.ts";
import { createActivity, createBlock, createPredictableIds } from "../plan/test-data.ts";
import { DAY, SLOT, WEEK, sanitizeDayEnd, sanitizeDayStart } from "../plan/time.ts";
import { convertPlan, merge, readPlan, takeSnapshot, type Change, type Rows } from "./index.ts";
import { compare as compareStamps, parse as parseStamp, type Stamp } from "./stamp.ts";
import { act, createNode, receive, send, type Node } from "./test-data.ts";

/** How many runs, each with its own seed, and how many events each run has. */
const RUNS = 400;
const EVENTS = 80;
const BATCH = 25;
const START = 1_763_200_000_000;

/** A seeded random number generator (mulberry32): the same seed, the same numbers. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  /** A whole number from `low` to `high`, both included. */
  const integer = (low: number, high: number): number =>
    low + Math.floor(next() * (high - low + 1));
  const pick = <Item>(items: readonly Item[]): Item | undefined =>
    items[integer(0, items.length - 1)];
  const isChance = (probability: number): boolean => next() < probability;
  return { next, integer, pick, isChance };
}

type Random = ReturnType<typeof createRandom>;

/** A node's wall clock: how far it's off from the true time, and whether it's stuck. */
type WallClock = { offset: number; isStuck: boolean; stuckAt: number };

/** Clocks that agree, that run ahead by hours or days, that lag, and that don't move at all. */
function createWallClock(random: Random): WallClock {
  const kind = random.integer(0, 5);
  const offsets = [
    random.integer(-2000, 2000),
    random.integer(-2000, 2000),
    random.integer(3_600_000, 86_400_000 * 3),
    -random.integer(60_000, 3_600_000),
    random.integer(-500, 500),
    0,
  ];
  return {
    offset: offsets[kind] ?? 0,
    isStuck: kind >= 4,
    stuckAt: START + random.integer(0, 5000),
  };
}

const readWallClock = (clock: WallClock, now: number): number =>
  clock.isStuck ? clock.stuckAt : now + clock.offset;

type SimulatedNode = Node & {
  readonly wallClock: WallClock;
  /** Activities and blocks this node removed, to bring back as an undo would. */
  readonly removed: { activities: Activity[]; blocks: Block[] };
  /** The changes this node has merged, its own included, by number. */
  readonly seen: Set<number>;
  count: number;
};

const NAMES = ["Work", "Gym", "Read", "Cook", "Run", "Yoga", "Study", "Call mum", "Swim"];

/** One random user action on the plan a node shows, as the app could make it. */
function createAction(random: Random, node: SimulatedNode): (shown: Plan) => Plan {
  const newId = (kind: string): string => `${node.id}-${kind}${String((node.count += 1))}`;
  return (shown) => {
    const activity = random.pick(shown.activities);
    const block = random.pick(shown.blocks);
    const choice = random.integer(0, 14);
    if (choice === 0 || activity === undefined) {
      const mode = random.isChance(0.5) ? "day" : "week";
      const added = createActivity({
        id: newId("a"),
        name: random.pick(NAMES) ?? "Work",
        hue: random.pick(PALETTE)?.hue ?? 255,
        shape: random.pick(DEFAULT_SHAPES) ?? "circle",
        mode,
        budgetMinutes: SLOT * random.integer(1, (mode === "day" ? DAY : WEEK) / SLOT),
        days: random.integer(1, 7),
      });
      const appended = activityList.add(shown, added);
      return activityList.move(appended, added.id, random.integer(0, shown.activities.length));
    }

    const { id: _, ...values } = activity;
    switch (choice) {
      case 1:
        return activityList.update(shown, activity.id, {
          ...values,
          name: createActivity({ name: random.pick(NAMES) ?? "Work" }).name,
        });
      case 2:
        return activityList.update(shown, activity.id, {
          ...values,
          hue: random.pick(PALETTE)?.hue ?? 255,
          shape: random.pick(DEFAULT_SHAPES) ?? "circle",
        });
      case 3: {
        const mode = random.isChance(0.5) ? "day" : "week";
        const budget = createActivity({
          mode,
          budgetMinutes: SLOT * random.integer(1, (mode === "day" ? DAY : WEEK) / SLOT),
          days: random.integer(1, 7),
        });
        return activityList.update(shown, activity.id, {
          ...values,
          mode,
          budgetMinutes: budget.budgetMinutes,
          days: budget.days,
        });
      }
      case 4: {
        node.removed.activities.push(activity);
        node.removed.blocks.push(...shown.blocks.filter((each) => each.activityId === activity.id));
        return activityList.remove(shown, activity.id).plan;
      }
      case 5:
        return activityList.move(
          shown,
          activity.id,
          random.integer(0, shown.activities.length - 1),
        );
      case 6:
      case 7:
        return {
          ...shown,
          blocks: [
            ...shown.blocks,
            createBlock({
              id: newId("b"),
              activityId: activity.id,
              day: random.integer(0, 6),
              start: SLOT * random.integer(0, DAY / SLOT - 1),
              length: SLOT * random.integer(1, 16),
            }),
          ],
        };
      case 8:
      case 9: {
        if (block === undefined) return shown;

        const changed = createBlock({
          ...block,
          ...(choice === 8
            ? { day: random.integer(0, 6), start: SLOT * random.integer(0, DAY / SLOT - 1) }
            : { length: SLOT * random.integer(1, DAY / SLOT) }),
        });
        return {
          ...shown,
          blocks: shown.blocks.map((each) => (each.id === block.id ? changed : each)),
        };
      }
      case 10: {
        if (block === undefined) return shown;

        node.removed.blocks.push(block);
        return { ...shown, blocks: shown.blocks.filter((each) => each.id !== block.id) };
      }
      case 11: {
        // Undo a removal: the activity comes back with the same id, and its blocks with it.
        const back = random.pick(node.removed.activities);
        if (back === undefined || shown.activities.some((each) => each.id === back.id))
          return shown;

        const ids = new Set(shown.blocks.values().map((each) => each.id));
        // A block removed more than once is in the list more than once: bring it back once.
        const blocks = [
          ...new Map(
            node.removed.blocks
              .values()
              .filter((each) => each.activityId === back.id && !ids.has(each.id))
              .map((each) => [each.id, each]),
          ).values(),
        ];
        const added = activityList.add(shown, back);
        return {
          ...activityList.move(added, back.id, random.integer(0, shown.activities.length)),
          blocks: [...shown.blocks, ...blocks],
        };
      }
      case 12: {
        const back = random.pick(node.removed.blocks);
        const isOwned = shown.activities.some((each) => each.id === back?.activityId);
        if (back === undefined || !isOwned || shown.blocks.some((each) => each.id === back.id))
          return shown;

        return { ...shown, blocks: [...shown.blocks, back] };
      }
      case 13:
        return random.isChance(0.5)
          ? { ...shown, dayStart: sanitizeDayStart(random.integer(0, 12)) }
          : { ...shown, dayEnd: sanitizeDayEnd(random.integer(13, 24)) };
      default:
        return {
          ...shown,
          exampleLoadedAt: random.isChance(0.5)
            ? null
            : Temporal.Instant.fromEpochMilliseconds(
                START + random.integer(0, 1_000_000),
              ).toString(),
        };
    }
  };
}

/** A change on its way to a node: due at an event, or held back until the end. */
type Delivery = { change: number; to: number; dueAt: number };

/** Every register of a row, by name. */
const listRegisters = (row: object): [string, { value: unknown; stamp: Stamp }][] =>
  Object.entries(row).filter(
    (entry): entry is [string, { value: unknown; stamp: Stamp }] =>
      typeof entry[1] === "object" && entry[1] !== null && "stamp" in entry[1],
  );

/** Finds a row of the rows by the kind of a row in a change, and its id, if it has one. */
function findRow(
  rows: Rows,
  kind: "activity" | "block" | "settings",
  id?: string,
): object | undefined {
  if (kind === "settings") return rows.settings;

  const all: ReadonlyMap<string, object> = kind === "activity" ? rows.activities : rows.blocks;
  return all.get(id ?? "");
}

/** A register of a held row, by name. */
function readRegister(row: object, name: string): { value: unknown; stamp: Stamp } | undefined {
  const field: unknown = Reflect.get(row, name);
  if (typeof field !== "object" || field === null) return undefined;

  const stamp = parseStamp(Reflect.get(field, "stamp"));
  return stamp === undefined ? undefined : { value: Reflect.get(field, "value"), stamp };
}

/** A run breaks a rule: the run stops, and the test reports what broke and the seed. */
function check(isKept: boolean, rule: string): void {
  if (!isKept) throw new Error(rule);
}

/**
 * Whether two values are the same. Comparing their JSON is much faster than a deep comparison,
 * which only runs when the JSON differs, to find whether only the order of some keys did.
 */
const isSame = (first: unknown, second: unknown): boolean =>
  JSON.stringify(first) === JSON.stringify(second) || isDeepStrictEqual(first, second);

const isSameRows = (first: Rows, second: Rows): boolean =>
  isSame(takeSnapshot(first), takeSnapshot(second));

/** Whether `sanitizePlan` leaves the plan the rows show as it is. */
function isValid(rows: Rows): boolean {
  const shown = readPlan(rows);
  return isSame(sanitizePlan(shown, createPredictableIds()), shown);
}

/**
 * Checks that every value a change saved is still in the rows, unless a later stamp replaced it.
 * A deleted row keeps its values too, so that holds for deleted rows as well.
 */
function checkKept(rows: Rows, change: Change): void {
  const rowsOfChange: (readonly ["activity" | "block" | "settings", object, string | undefined])[] =
    [
      ...change.activities.map((row) => ["activity", row, row.id] as const),
      ...change.blocks.map((row) => ["block", row, row.id] as const),
      ...(change.settings === null ? [] : [["settings", change.settings, undefined] as const]),
    ];
  for (const [kind, saved, id] of rowsOfChange) {
    const held = findRow(rows, kind, id);
    check(held !== undefined, `the ${kind} ${String(id)} a change saved is still there`);
    for (const [name, register] of listRegisters(saved)) {
      const now = held === undefined ? undefined : readRegister(held, name);
      const order = now === undefined ? -1 : compareStamps(now.stamp, register.stamp);
      check(order >= 0, `the ${name} of ${kind} ${String(id)} is as saved or later`);
      const isSameValue = order > 0 || isSame(now?.value, register.value);
      check(
        isSameValue,
        `the ${name} of ${kind} ${String(id)} keeps the value saved with its stamp`,
      );
    }
  }
}

/** The items in an order the seed sets (Fisher and Yates). */
function shuffle<Item>(items: readonly Item[], random: Random): Item[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = random.integer(0, index);
    const item = shuffled[index];
    const swapped = shuffled[other];
    if (item === undefined || swapped === undefined) continue;

    shuffled[index] = swapped;
    shuffled[other] = item;
  }

  return shuffled;
}

/** The state of a run: its nodes, every change made so far, and those still on their way. */
type Run = {
  readonly random: Random;
  readonly nodes: readonly SimulatedNode[];
  readonly changes: Change[];
  deliveries: Delivery[];
};

/**
 * Whether a node shows the plan its action made. The one difference allowed: an activity that
 * came back (an undo of its deletion) brings back the blocks other nodes added to it while it was
 * deleted, which the node didn't know about.
 */
function isShowingAction(shown: Plan, before: Plan, after: Plan): boolean {
  const returned = new Set(
    after.activities
      .values()
      .filter((activity) => !before.activities.some((each) => each.id === activity.id))
      .map((activity) => activity.id),
  );
  const isInAfter = (block: Block): boolean => after.blocks.some((each) => each.id === block.id);
  const isExpected = (block: Block): boolean => isInAfter(block) || returned.has(block.activityId);
  const expected = after.blocks.toSorted((first, second) => (first.id < second.id ? -1 : 1));
  return (
    shown.blocks.every((block) => isExpected(block)) &&
    isSame(
      { ...shown, blocks: shown.blocks.filter((block) => isInAfter(block)) },
      { ...after, blocks: expected },
    )
  );
}

/** A random node does a random action, and its change sets off to the others. */
function performAction(run: Run, event: number, now: number): void {
  const node = run.random.pick(run.nodes);
  if (node === undefined) return;

  const clockBefore = node.clock;
  const rowsBefore = node.rows;
  const perform = createAction(run.random, node);
  const before = readPlan(node.rows);
  let after = before;
  const change = act(node, readWallClock(node.wallClock, now), (shown) => {
    after = perform(shown);
    return after;
  });
  check(
    isShowingAction(readPlan(node.rows), before, after),
    "a node shows the plan its action made",
  );
  check(compareStamps(node.clock, clockBefore) > 0, "a new stamp is later than the clock");
  check(isSameRows(node.rows, merge(rowsBefore, change)), "a node saves what its change merges to");
  check(isValid(node.rows), "the plan after an action passes sanitizePlan unchanged");
  const number = run.changes.push(change) - 1;
  node.seen.add(number);
  for (const [to, other] of run.nodes.entries()) {
    if (other === node) continue;

    // Lost until the final exchange, delivered once, or delivered twice.
    const fate = run.random.next();
    if (fate < 0.15) continue;

    const dueAt = event + run.random.integer(0, 20);
    run.deliveries.push({ change: number, to, dueAt });
    if (fate > 0.85)
      run.deliveries.push({ change: number, to, dueAt: dueAt + run.random.integer(0, 10) });
  }
}

/** The changes a node merged, as text, to find nodes that merged the same ones. */
const listSeen = (node: SimulatedNode): string =>
  [...node.seen].toSorted((first, second) => first - second).join(",");

/** A node merges a change that was due, picked at random, so changes arrive out of order. */
function deliver(run: Run, delivery: Delivery): void {
  run.deliveries = run.deliveries.filter((each) => each !== delivery);
  const node = run.nodes[delivery.to];
  const change = run.changes[delivery.change];
  if (node === undefined || change === undefined) return;

  receive(node, change);
  node.seen.add(delivery.change);
  check(isValid(node.rows), "the plan after a merge passes sanitizePlan unchanged");
  const seen = listSeen(node);
  for (const other of run.nodes) {
    if (other === node || listSeen(other) !== seen) continue;

    check(
      isSameRows(other.rows, node.rows),
      "nodes that merged the same changes hold the same rows",
    );
  }
}

function runSimulation(seed: number): void {
  const random = createRandom(seed);
  const start = random.isChance(0.7)
    ? sanitizePlan(exampleWeek, createPredictableIds())
    : createEmptyPlan();
  const initial = convertPlan(start);
  const nodes: SimulatedNode[] = Array.from({ length: random.integer(2, 4) }, (_, index) => ({
    ...createNode(`node${String(index)}`, initial),
    wallClock: createWallClock(random),
    removed: { activities: [], blocks: [] },
    seen: new Set<number>(),
    count: 0,
  }));
  const run: Run = { random, nodes, changes: [], deliveries: [] };
  let now = START;
  for (let event = 0; event < EVENTS; event += 1) {
    now += random.isChance(0.3) ? 0 : random.integer(1, 3000);
    const due = run.deliveries.filter((delivery) => delivery.dueAt <= event);
    const delivery = random.isChance(0.4) ? random.pick(due) : undefined;
    if (delivery === undefined) performAction(run, event, now);
    // oxlint-disable-next-line week-budget-planner/no-else -- each event is one of two things, side by side.
    else deliver(run, delivery);
  }

  // The final exchange: every node merges every other's snapshot.
  const snapshots = nodes.map((node) => send(takeSnapshot(node.rows)));
  for (const node of nodes) for (const snapshot of snapshots) receive(node, snapshot);

  const finalRows = nodes[0]?.rows ?? initial;
  for (const node of nodes)
    check(
      isSameRows(node.rows, finalRows),
      "after the final exchange, every node holds the same rows",
    );

  check(isValid(finalRows), "the merged plan passes sanitizePlan unchanged");

  // Merge order doesn't matter, and merging a change twice changes nothing.
  const shuffled = shuffle(run.changes, random);
  const doubled = [...shuffled, ...shuffle(run.changes, random)];
  for (const order of [run.changes, shuffled, doubled]) {
    const merged = order.reduce((rows, change) => merge(rows, change), initial);
    check(
      isSameRows(merged, finalRows),
      "the changes merge to the same rows in any order, and twice",
    );
  }

  for (const change of run.changes)
    check(
      isSameRows(merge(finalRows, change), finalRows),
      "merging a change again changes nothing",
    );

  for (const change of run.changes) checkKept(finalRows, change);
}

/** What broke in the run with `seed`, or nothing when every rule held. */
function findBrokenRule(seed: number): string[] {
  try {
    runSimulation(seed);
  } catch (error) {
    const rule = error instanceof Error ? error.message : String(error);
    return [`seed ${String(seed)}: ${rule} (replay it with MERGE_SEED=${String(seed)})`];
  }

  return [];
}

/** The seeds, in batches that each finish well within a test's time limit. */
function listBatches(): number[][] {
  const only = process.env["MERGE_SEED"];
  if (only !== undefined) return [[Number(only)]];

  return Array.from({ length: RUNS / BATCH }, (_, batch) =>
    Array.from({ length: BATCH }, (_unused, index) => batch * BATCH + index + 1),
  );
}

describe("simulation", () => {
  it.each(listBatches())("converges on the same valid plan from seed %i on", (...seeds) => {
    expect(seeds.flatMap((seed) => findBrokenRule(seed))).toEqual([]);
  });
});
