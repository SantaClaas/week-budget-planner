// Making a change from a user action: apply it to the plan the rows show, compare the plan before
// and after, and give what changed the action's one stamp (see The idea and Deleting in
// docs/spec/merge.md).
import type { Activity } from "../plan/activity/index.ts";
import type { Block } from "../plan/block/index.ts";
import type { ActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { FORMAT_VERSION, merge, readPlan, type Change, type Rows } from "./index.ts";
import { assign, type OrderKey } from "./order.ts";
import { isSame, type Register, type Value } from "./register.ts";
import type {
  ActivityExistence,
  ActivityRow,
  BlockExistence,
  BlockRow,
  BlockTime,
  Budget,
  SettingsRow,
} from "./row.ts";
import type { Stamp } from "./stamp.ts";

/** An activity row's values, without their stamps. */
type ActivityValues = {
  name: ActivityRow["name"]["value"];
  hue: ActivityRow["hue"]["value"];
  shape: ActivityRow["shape"]["value"];
  budget: Budget;
  order: OrderKey;
  existence: ActivityExistence;
};

type BlockValues = { time: BlockTime; existence: BlockExistence };

type SettingsValues = Pick<Plan, "dayStart" | "dayEnd" | "exampleLoadedAt">;

/**
 * One register after the action.
 *
 * @param held - The register as the node holds it, or undefined for a new row.
 * @param previous - Its value before the action, or undefined for a new row.
 * @param next - Its value after the action.
 * @param stamp - The action's stamp.
 * @returns `held` itself when its value didn't change, otherwise the new value with the stamp.
 */
function write<Of extends Value>(
  held: Register<Of> | undefined,
  previous: Of | undefined,
  next: Of,
  stamp: Stamp,
): Register<Of> {
  if (held !== undefined && previous !== undefined && isSame(previous, next)) return held;

  return { value: next, stamp };
}

const readActivityValues = (activity: Activity, order: OrderKey): ActivityValues => ({
  name: activity.name,
  hue: activity.hue,
  shape: activity.shape,
  budget: { mode: activity.mode, budgetMinutes: activity.budgetMinutes, days: activity.days },
  order,
  existence: { isDeleted: false },
});

const readActivityRow = (row: ActivityRow): ActivityValues => ({
  name: row.name.value,
  hue: row.hue.value,
  shape: row.shape.value,
  budget: row.budget.value,
  order: row.order.value,
  existence: row.existence.value,
});

/**
 * Whether the action kept the activities' order: it added none, brought none back, and the ones
 * it kept are in the order they were.
 */
function isOrderKept(before: Plan, after: Plan): boolean {
  const beforeIds = new Set(before.activities.values().map((activity) => activity.id));
  const afterIds = new Set(after.activities.values().map((activity) => activity.id));
  if (!afterIds.isSubsetOf(beforeIds)) return false;

  return before.activities
    .values()
    .filter((activity) => afterIds.has(activity.id))
    .every((activity, index) => activity.id === after.activities[index]?.id);
}

/**
 * The order keys of the activities after, by id. Only an action that changed the order gives new
 * keys, to as few activities as possible; any other keeps them all, even two that are equal.
 */
function assignOrderKeys(rows: Rows, before: Plan, after: Plan): Map<ActivityId, OrderKey> {
  const held = after.activities.map((activity) => rows.activities.get(activity.id)?.order.value);
  const keys = isOrderKept(before, after) ? held : assign(held);
  return new Map(
    after.activities.values().flatMap((activity, index) => {
      const key = keys[index];
      return key === undefined ? [] : [[activity.id, key] as const];
    }),
  );
}

/**
 * Whether the action wrote a register of a row, or the row is new.
 *
 * @param held - The row as the node holds it, or undefined for a new one.
 * @param row - The row after the action, whose unwritten registers are `held`'s own objects.
 */
const isWritten = (held: object | undefined, row: object): boolean =>
  held === undefined ||
  Object.entries(row).some(([key, field]) => field !== Reflect.get(held, key));

/** The value, or a throw for one the code made sure is there. */
function ensure<Of>(value: Of | undefined, what: string): Of {
  if (value === undefined) throw new Error(`Missing ${what}.`);

  return value;
}

/**
 * One activity's row after the action, or undefined when the action didn't touch it. What it was
 * before is the plan's activity when it was there, otherwise the row as held: an activity that
 * comes back (an undo of a delete, with the same id) then gets its existence written again, and
 * any register whose value the plan after doesn't share.
 */
function writeActivity(
  held: ActivityRow | undefined,
  previous: ActivityValues | undefined,
  next: ActivityValues,
  id: ActivityId,
  stamp: Stamp,
): ActivityRow | undefined {
  const row: ActivityRow = {
    id,
    name: write(held?.name, previous?.name, next.name, stamp),
    hue: write(held?.hue, previous?.hue, next.hue, stamp),
    shape: write(held?.shape, previous?.shape, next.shape, stamp),
    budget: write(held?.budget, previous?.budget, next.budget, stamp),
    order: write(held?.order, previous?.order, next.order, stamp),
    existence: write(held?.existence, previous?.existence, next.existence, stamp),
  };
  return isWritten(held, row) ? row : undefined;
}

/** The activities' rows the action touched. */
function writeActivities(rows: Rows, before: Plan, after: Plan, stamp: Stamp): ActivityRow[] {
  const keys = assignOrderKeys(rows, before, after);
  const beforeById = new Map(before.activities.values().map((activity) => [activity.id, activity]));
  const afterById = new Map(after.activities.values().map((activity) => [activity.id, activity]));
  const ids = new Set(beforeById.keys()).union(afterById);
  const touched: ActivityRow[] = [];
  for (const id of ids) {
    const held = rows.activities.get(id);
    const was = beforeById.get(id);
    const previous =
      was === undefined || held === undefined
        ? held && readActivityRow(held)
        : readActivityValues(was, held.order.value);
    const now = afterById.get(id);
    const next =
      now === undefined
        ? previous && { ...previous, existence: { isDeleted: true } }
        : readActivityValues(now, ensure(keys.get(id), "an order key"));
    if (next === undefined) continue;

    const row = writeActivity(held, previous, next, id, stamp);
    if (row !== undefined) touched.push(row);
  }

  return touched;
}

const readBlockValues = (block: Block): BlockValues => ({
  time: { day: block.day, start: block.start, length: block.length },
  existence: { activityId: block.activityId, isDeleted: false },
});

const readBlockRow = (row: BlockRow): BlockValues => ({
  time: row.time.value,
  existence: row.existence.value,
});

/** The blocks' rows the action touched, with the same rule as for activities. */
function writeBlocks(rows: Rows, before: Plan, after: Plan, stamp: Stamp): BlockRow[] {
  const beforeById = new Map(before.blocks.values().map((block) => [block.id, block]));
  const afterById = new Map(after.blocks.values().map((block) => [block.id, block]));
  const ids = new Set(beforeById.keys()).union(afterById);
  const touched: BlockRow[] = [];
  for (const id of ids) {
    const held = rows.blocks.get(id);
    const was = beforeById.get(id);
    const previous =
      was === undefined || held === undefined ? held && readBlockRow(held) : readBlockValues(was);
    const now = afterById.get(id);
    const next =
      now === undefined
        ? previous && { ...previous, existence: { ...previous.existence, isDeleted: true } }
        : readBlockValues(now);
    if (next === undefined) continue;

    const row: BlockRow = {
      id,
      time: write(held?.time, previous?.time, next.time, stamp),
      existence: write(held?.existence, previous?.existence, next.existence, stamp),
    };
    if (isWritten(held, row)) touched.push(row);
  }

  return touched;
}

/** The settings row after the action, or null when the action didn't touch it. */
function writeSettings(
  held: SettingsRow,
  before: SettingsValues,
  after: SettingsValues,
  stamp: Stamp,
): SettingsRow | null {
  const row: SettingsRow = {
    dayStart: write(held.dayStart, before.dayStart, after.dayStart, stamp),
    dayEnd: write(held.dayEnd, before.dayEnd, after.dayEnd, stamp),
    exampleLoadedAt: write(
      held.exampleLoadedAt,
      before.exampleLoadedAt,
      after.exampleLoadedAt,
      stamp,
    ),
  };
  return isWritten(held, row) ? row : null;
}

/**
 * Makes the change for one user action. Call it in the same transaction that reads the rows and
 * saves what it gives back.
 *
 * It takes the action, not a plan after, on purpose: every register that differs between the
 * plan the rows show and the plan after gets the stamp. A plan after built on an older plan, one a
 * tab showed before another device's change was merged, would differ in what that change wrote,
 * and stamp it back to how it was, on every node. Applied to the plan the rows show, the action can
 * only differ in what it did itself.
 *
 * @param rows - The rows the node holds.
 * @param update - The action: it gets the plan the rows show and gives back the plan after, as the
 *   planner's actions do.
 * @param stamp - The action's one stamp, from the node's clock (see `clock.issueNext`).
 * @returns The rows with the action written, and the change to send. Only registers whose values
 *   changed get the stamp. A removed activity or block is marked deleted, not removed. The change
 *   holds the touched rows, whole, and with each touched block its activity's row, so it never
 *   points at a row the receiver might not have.
 */
export function make(
  rows: Rows,
  update: (before: Plan) => Plan,
  stamp: Stamp,
): { rows: Rows; change: Change } {
  const before = readPlan(rows);
  const after = update(before);
  const activities = writeActivities(rows, before, after, stamp);
  const blocks = writeBlocks(rows, before, after, stamp);
  const settings = writeSettings(rows.settings, before, after, stamp);
  const written = merge(rows, {
    version: FORMAT_VERSION,
    activities,
    blocks,
    settings,
    devices: [],
  });
  const included = new Map(activities.values().map((row) => [row.id, row]));
  for (const block of blocks) {
    const id = block.existence.value.activityId;
    included.set(id, ensure(written.activities.get(id), `a row for the activity ${id}`));
  }

  return {
    rows: written,
    change: {
      version: FORMAT_VERSION,
      activities: [...included.values()],
      blocks,
      settings,
      devices: [],
    },
  };
}
