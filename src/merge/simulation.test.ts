// Deterministic simulation (see Tests in docs/spec/merge.md): several nodes in one process, each
// with its own rows, clock and wall clock, and a seeded scheduler that makes random user actions on
// random nodes and delivers their changes late, twice, out of order, or not at all until a final
// exchange of snapshots. The same seed replays the same run: a failing run names its seed, and
// MERGE_SEED=<seed> pnpm test src/merge/simulation.test.ts runs that one alone. Every run checks
// the same seeds; MERGE_SEEDS_FROM=<seed> checks as many others, starting there.
//
// The random numbers come from mulberry32, a public-domain generator by Tommy Ettinger
// (https://gist.github.com/tommyettinger/46a874533244883189143505d203312c), written anew here.
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

/** How many runs, each with its own seed, and how many of them one test makes. */
const RUNS = 400;
const BATCH = 25;
const START = 1_763_200_000_000;

/** A seeded random number generator (mulberry32): the same seed, the same numbers. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  /** A number from 0 up to, not including, 1. */
  const pickFraction = (): number => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  /** A whole number from `low` to `high`, both included. */
  const pickInteger = (low: number, high: number): number =>
    low + Math.floor(pickFraction() * (high - low + 1));
  const pick = <Item>(items: readonly Item[]): Item | undefined =>
    items[pickInteger(0, items.length - 1)];
  /** One of the items, each as likely as its weight says, relative to the others. */
  const pickWeighted = <Item extends { readonly weight: number }>(
    items: readonly Item[],
  ): Item | undefined => {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let left = pickFraction() * total;
    return items.find((item) => (left -= item.weight) < 0) ?? items.at(-1);
  };
  const isChance = (probability: number): boolean => pickFraction() < probability;
  return { pickFraction, pickInteger, pick, pickWeighted, isChance };
}

type Random = ReturnType<typeof createRandom>;

/** A node's wall clock: how far it's off from the true time, and whether it's stuck. */
type WallClock = { offset: number; isStuck: boolean; stuckAt: number };

/** Clocks that agree, that run ahead by hours or days, that lag, and that don't move at all. */
function createWallClock(random: Random): WallClock {
  const kind = random.pickInteger(0, 5);
  const offsets = [
    random.pickInteger(-2000, 2000),
    random.pickInteger(-2000, 2000),
    random.pickInteger(3_600_000, 86_400_000 * 3),
    -random.pickInteger(60_000, 3_600_000),
    random.pickInteger(-500, 500),
    0,
  ];
  return {
    offset: offsets[kind] ?? 0,
    isStuck: kind >= 4,
    stuckAt: START + random.pickInteger(0, 5000),
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

/** What an action needs besides the plan a node shows. */
type Context = {
  readonly random: Random;
  readonly node: SimulatedNode;
  /** A new id for an activity or a block that this node adds. */
  readonly createId: (kind: "a" | "b") => string;
};

/** A user action, as the app could make it: the plan a node shows, and the plan after. */
type Perform = (shown: Plan, context: Context) => Plan;

/** A budget picked at random, valid for its mode. */
function pickBudget(random: Random): Pick<Activity, "mode" | "budgetMinutes" | "days"> {
  const mode = random.isChance(0.5) ? "day" : "week";
  const { budgetMinutes, days } = createActivity({
    mode,
    budgetMinutes: SLOT * random.pickInteger(1, (mode === "day" ? DAY : WEEK) / SLOT),
    days: random.pickInteger(1, 7),
  });
  return { mode, budgetMinutes, days };
}

const addActivity: Perform = (shown, { random, createId }) => {
  const added = createActivity({
    id: createId("a"),
    name: random.pick(NAMES) ?? "Work",
    hue: random.pick(PALETTE)?.hue ?? 255,
    shape: random.pick(DEFAULT_SHAPES) ?? "circle",
    ...pickBudget(random),
  });
  const appended = activityList.add(shown, added);
  return activityList.move(appended, added.id, random.pickInteger(0, shown.activities.length));
};

/** An action on an activity the node shows, which does nothing where there is none. */
const applyToActivity =
  (perform: (shown: Plan, activity: Activity, context: Context) => Plan): Perform =>
  (shown, context) => {
    const activity = context.random.pick(shown.activities);
    return activity === undefined ? shown : perform(shown, activity, context);
  };

/** An action on a block the node shows, which does nothing where there is none. */
const applyToBlock =
  (perform: (shown: Plan, block: Block, context: Context) => Plan): Perform =>
  (shown, context) => {
    const block = context.random.pick(shown.blocks);
    return block === undefined ? shown : perform(shown, block, context);
  };

const replaceBlock = (shown: Plan, changed: Block): Plan => ({
  ...shown,
  blocks: shown.blocks.map((each) => (each.id === changed.id ? changed : each)),
});

const renameActivity = applyToActivity((shown, activity, { random }) =>
  activityList.update(shown, activity.id, {
    ...activity,
    name: createActivity({ name: random.pick(NAMES) ?? "Work" }).name,
  }),
);

const changeLook = applyToActivity((shown, activity, { random }) =>
  activityList.update(shown, activity.id, {
    ...activity,
    hue: random.pick(PALETTE)?.hue ?? 255,
    shape: random.pick(DEFAULT_SHAPES) ?? "circle",
  }),
);

const changeBudget = applyToActivity((shown, activity, { random }) =>
  activityList.update(shown, activity.id, { ...activity, ...pickBudget(random) }),
);

const removeActivity = applyToActivity((shown, activity, { node }) => {
  node.removed.activities.push(activity);
  node.removed.blocks.push(...shown.blocks.filter((each) => each.activityId === activity.id));
  return activityList.remove(shown, activity.id).plan;
});

const reorderActivity = applyToActivity((shown, activity, { random }) =>
  activityList.move(shown, activity.id, random.pickInteger(0, shown.activities.length - 1)),
);

const addBlock = applyToActivity((shown, activity, { random, createId }) => ({
  ...shown,
  blocks: [
    ...shown.blocks,
    createBlock({
      id: createId("b"),
      activityId: activity.id,
      day: random.pickInteger(0, 6),
      start: SLOT * random.pickInteger(0, DAY / SLOT - 1),
      length: SLOT * random.pickInteger(1, 16),
    }),
  ],
}));

const moveBlock = applyToBlock((shown, block, { random }) =>
  replaceBlock(
    shown,
    createBlock({
      ...block,
      day: random.pickInteger(0, 6),
      start: SLOT * random.pickInteger(0, DAY / SLOT - 1),
    }),
  ),
);

const resizeBlock = applyToBlock((shown, block, { random }) =>
  replaceBlock(shown, createBlock({ ...block, length: SLOT * random.pickInteger(1, DAY / SLOT) })),
);

const removeBlock = applyToBlock((shown, block, { node }) => {
  node.removed.blocks.push(block);
  return { ...shown, blocks: shown.blocks.filter((each) => each.id !== block.id) };
});

/** Undoes a removal: the activity comes back with the same id, and its blocks with it. */
const bringBackActivity: Perform = (shown, { random, node }) => {
  const back = random.pick(node.removed.activities);
  if (back === undefined || shown.activities.some((each) => each.id === back.id)) return shown;

  const ids = new Set(shown.blocks.values().map((each) => each.id));
  // A block removed more than once is in the list more than once: bring it back once.
  const blocks = new Map(
    node.removed.blocks
      .values()
      .filter((each) => each.activityId === back.id && !ids.has(each.id))
      .map((each) => [each.id, each]),
  ).values();
  const added = activityList.add(shown, back);
  return {
    ...activityList.move(added, back.id, random.pickInteger(0, shown.activities.length)),
    blocks: [...shown.blocks, ...blocks],
  };
};

/** Undoes the removal of a block whose activity is there. */
const bringBackBlock: Perform = (shown, { random, node }) => {
  const back = random.pick(node.removed.blocks);
  const isOwned = shown.activities.some((each) => each.id === back?.activityId);
  if (back === undefined || !isOwned || shown.blocks.some((each) => each.id === back.id))
    return shown;

  return { ...shown, blocks: [...shown.blocks, back] };
};

const setDayHours: Perform = (shown, { random }) =>
  random.isChance(0.5)
    ? { ...shown, dayStart: sanitizeDayStart(random.pickInteger(0, 12)) }
    : { ...shown, dayEnd: sanitizeDayEnd(random.pickInteger(13, 24)) };

/** Loads the example week again, or keeps it: only its time, which is what the merge sees. */
const setExampleLoadedAt: Perform = (shown, { random }) => ({
  ...shown,
  exampleLoadedAt: random.isChance(0.5)
    ? null
    : Temporal.Instant.fromEpochMilliseconds(START + random.pickInteger(0, 1_000_000)).toString(),
});

/** An action, with how often it's picked relative to the others. */
type Weighted = { readonly weight: number; readonly perform: Perform };

/** The actions a user can make, in their usual mix. */
const ACTIONS: readonly Weighted[] = [
  { weight: 1, perform: addActivity },
  { weight: 1, perform: renameActivity },
  { weight: 1, perform: changeLook },
  { weight: 1, perform: changeBudget },
  { weight: 1, perform: removeActivity },
  { weight: 1, perform: reorderActivity },
  // Twice as often, so the week fills up.
  { weight: 2, perform: addBlock },
  { weight: 1, perform: moveBlock },
  { weight: 1, perform: resizeBlock },
  { weight: 1, perform: removeBlock },
  { weight: 1, perform: bringBackActivity },
  { weight: 1, perform: bringBackBlock },
  { weight: 1, perform: setDayHours },
  { weight: 1, perform: setExampleLoadedAt },
];

/**
 * What a run is like, picked by its seed (swarm testing): how many nodes and events it has, how
 * often each action happens, and how unreliable delivery is. Runs that each lean one way reach
 * states that one balanced mix rarely does, such as a long stretch of removals and undos, or a node
 * that hears almost nothing until the final exchange.
 */
type Shape = {
  readonly nodes: number;
  readonly events: number;
  readonly actions: readonly Weighted[];
  /** How likely a change is lost until the final exchange, and how likely it arrives twice. */
  readonly loss: number;
  readonly duplication: number;
  /** The most events a change takes to arrive. */
  readonly delay: number;
  /** How likely an event delivers a change that's due, rather than making an action. */
  readonly delivery: number;
};

/**
 * Picks a run's shape.
 *
 * @returns Each action left out, in its usual weight or four times as common, and the other parts
 *   from a few values each, from gentle to harsh.
 */
function pickShape(random: Random): Shape {
  const leaning = ACTIONS.map((action) => ({
    ...action,
    weight: action.weight * (random.pick([0, 1, 1, 4]) ?? 1),
  }));
  return {
    nodes: random.pickInteger(2, 6),
    events: random.pick([20, 80, 80, 200]) ?? 80,
    actions: leaning.some((action) => action.weight > 0) ? leaning : ACTIONS,
    loss: random.pick([0, 0.15, 0.5]) ?? 0.15,
    duplication: random.pick([0, 0.15, 0.5]) ?? 0.15,
    delay: random.pick([0, 20, 60]) ?? 20,
    delivery: random.pick([0.1, 0.4, 0.7]) ?? 0.4,
  };
}

/**
 * One random user action of a node, picked by weight. A node with no activities always adds one,
 * since most actions need one.
 */
function createAction(
  random: Random,
  node: SimulatedNode,
  actions: readonly Weighted[],
): (shown: Plan) => Plan {
  const createId = (kind: "a" | "b"): string => `${node.id}-${kind}${String((node.count += 1))}`;
  const context: Context = { random, node, createId };
  return (shown) => {
    const action =
      shown.activities.length === 0 ? addActivity : random.pickWeighted(actions)?.perform;
    return (action ?? addActivity)(shown, context);
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

/** A row of a change, with its kind and its id, if it has one. */
type RowOfChange = readonly ["activity" | "block" | "settings", object, string | undefined];

const listRowsOfChange = (change: Change): RowOfChange[] => [
  ...change.activities.map((row) => ["activity", row, row.id] as const),
  ...change.blocks.map((row) => ["block", row, row.id] as const),
  ...(change.settings === null ? [] : [["settings", change.settings, undefined] as const]),
];

/**
 * Checks that every value a change saved is still in the rows, unless a later stamp replaced it.
 * A deleted row keeps its values too, so that holds for deleted rows as well.
 */
function checkKept(rows: Rows, change: Change): void {
  for (const [kind, saved, id] of listRowsOfChange(change)) {
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

/**
 * Checks that a change gives its stamp only to the registers whose value the action changed (see
 * Saving an action in docs/spec/merge.md). A register it carries unchanged keeps the stamp it had,
 * so it can't overwrite what another node changed meanwhile.
 */
function checkOnlyChanged(rowsBefore: Rows, change: Change): void {
  for (const [kind, saved, id] of listRowsOfChange(change)) {
    const held = findRow(rowsBefore, kind, id);
    if (held === undefined) continue;

    for (const [name, register] of listRegisters(saved)) {
      const before = readRegister(held, name);
      const isCarried = before !== undefined && compareStamps(before.stamp, register.stamp) === 0;
      check(
        isCarried || !isSame(before?.value, register.value),
        `the ${name} of ${kind} ${String(id)} gets a new stamp only when its value changed`,
      );
    }
  }
}

/** The items in an order the seed sets (Fisher and Yates). */
function shuffle<Item>(items: readonly Item[], random: Random): Item[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = random.pickInteger(0, index);
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
  readonly shape: Shape;
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
  const perform = createAction(run.random, node, run.shape.actions);
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
  checkOnlyChanged(rowsBefore, change);
  check(isValid(node.rows), "the plan after an action passes sanitizePlan unchanged");
  const number = run.changes.push(change) - 1;
  node.seen.add(number);
  for (const [to, other] of run.nodes.entries()) {
    if (other === node) continue;

    // Lost until the final exchange, delivered once, or delivered twice.
    const fate = run.random.pickFraction();
    if (fate < run.shape.loss) continue;

    const dueAt = event + run.random.pickInteger(0, run.shape.delay);
    run.deliveries.push({ change: number, to, dueAt });
    if (fate >= 1 - run.shape.duplication)
      run.deliveries.push({ change: number, to, dueAt: dueAt + run.random.pickInteger(0, 10) });
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
  const shape = pickShape(random);
  const start = random.isChance(0.7)
    ? sanitizePlan(exampleWeek, createPredictableIds())
    : createEmptyPlan();
  const initial = convertPlan(start);
  const nodes: SimulatedNode[] = Array.from({ length: shape.nodes }, (_, index) => ({
    ...createNode(`node${String(index)}`, initial),
    wallClock: createWallClock(random),
    removed: { activities: [], blocks: [] },
    seen: new Set<number>(),
    count: 0,
  }));
  const run: Run = { random, shape, nodes, changes: [], deliveries: [] };
  let now = START;
  for (let event = 0; event < shape.events; event += 1) {
    now += random.isChance(0.3) ? 0 : random.pickInteger(1, 3000);
    const due = run.deliveries.filter((delivery) => delivery.dueAt <= event);
    const delivery = random.isChance(shape.delivery) ? random.pick(due) : undefined;
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
    // The same seed picks the same shape, so it's picked again to say what the run was like.
    const { nodes, events } = pickShape(createRandom(seed));
    const shape = `${String(nodes)} nodes, ${String(events)} events`;
    return [`seed ${String(seed)} (${shape}): ${rule} (replay it with MERGE_SEED=${String(seed)})`];
  }

  return [];
}

/** The largest seed: the generator keeps 32 bits, so a larger one would replay a smaller one. */
const MAX_SEED = 0xff_ff_ff_ff;

/**
 * Reads a seed from the environment variable `name`.
 *
 * @param max The largest seed it may be.
 * @returns The seed, or undefined when the variable isn't set.
 * @throws {RangeError} When it isn't a whole number from 0 to `max`, so a typo can't quietly
 *   replay another run.
 */
function readSeed(name: string, max: number): number | undefined {
  const text = process.env[name];
  if (text === undefined) return undefined;

  const seed = Number(text);
  if (/^\d+$/u.test(text) && seed <= max) return seed;

  throw new RangeError(`${name} is "${text}", not a whole number from 0 to ${String(max)}.`);
}

/**
 * Lists the seeds, in batches that each finish well within a test's time limit. They are 1 to RUNS,
 * so every run checks the same weeks. MERGE_SEED runs one seed alone, and MERGE_SEEDS_FROM starts
 * the RUNS seeds somewhere else, to look for weeks the fixed seeds never reach.
 *
 * @returns The seeds, one list per test.
 */
function listBatches(): number[][] {
  const only = readSeed("MERGE_SEED", MAX_SEED);
  if (only !== undefined) return [[only]];

  const first = readSeed("MERGE_SEEDS_FROM", MAX_SEED - RUNS + 1) ?? 1;
  return Array.from({ length: RUNS / BATCH }, (_, batch) =>
    Array.from({ length: BATCH }, (_unused, index) => first + batch * BATCH + index),
  );
}

describe("simulation", () => {
  it.each(listBatches())("converges on the same valid plan from seed %i on", (...seeds) => {
    expect(seeds.flatMap((seed) => findBrokenRule(seed))).toEqual([]);
  });
});
