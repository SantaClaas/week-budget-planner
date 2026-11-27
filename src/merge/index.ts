// Merging changes: the rows a node keeps its plan in, merging a change or a snapshot into them,
// and reading the plan from them (see docs/spec/merge.md). Pure: time and ids are passed in.
import type { DeviceKey } from "../device/index.ts";
import type { ActivityId, BlockId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { compare as compareOrder, spread } from "./order.ts";
import {
  mergeActivity,
  mergeBlock,
  mergeDevice,
  mergeSettings,
  type ActivityRow,
  type BlockRow,
  type DeviceRow,
  type SettingsRow,
} from "./row.ts";
import { LOWEST, compare as compareStamps, type Stamp } from "./stamp.ts";

/**
 * The rows a node holds: every activity and block it has seen, deleted ones too, the settings, and
 * the group's device list.
 */
export type Rows = {
  readonly activities: ReadonlyMap<ActivityId, ActivityRow>;
  readonly blocks: ReadonlyMap<BlockId, BlockRow>;
  readonly settings: SettingsRow;
  readonly devices: ReadonlyMap<DeviceKey, DeviceRow>;
};

/** The version of the format of changes and snapshots. A newer one is refused (see check.ts). */
export const FORMAT_VERSION = 1;

/**
 * Rows to merge, as they are sent: a change holds the rows one action touched, whole, and with
 * each block its activity's row; a snapshot holds every row. The settings are null in a change
 * that didn't touch them.
 */
export type Change = {
  readonly version: typeof FORMAT_VERSION;
  readonly activities: readonly ActivityRow[];
  readonly blocks: readonly BlockRow[];
  readonly settings: SettingsRow | null;
  readonly devices: readonly DeviceRow[];
};

/**
 * Merges a change or a snapshot into the rows, register by register: the later stamp wins. The
 * same whatever order changes arrive in, and merging one twice changes nothing.
 *
 * @param rows - The rows the node holds.
 * @param change - A change or a snapshot, checked strictly if it was received.
 * @returns The rows with it merged in. Rows it didn't alter stay the same objects, so comparing by
 *   identity finds the ones to write.
 */
export function merge(rows: Rows, change: Change): Rows {
  const activities = new Map(rows.activities);
  for (const row of change.activities) {
    const held = activities.get(row.id);
    activities.set(row.id, held === undefined ? row : mergeActivity(held, row));
  }

  const blocks = new Map(rows.blocks);
  for (const row of change.blocks) {
    const held = blocks.get(row.id);
    blocks.set(row.id, held === undefined ? row : mergeBlock(held, row));
  }

  const settings =
    change.settings === null ? rows.settings : mergeSettings(rows.settings, change.settings);

  const devices = new Map(rows.devices);
  for (const row of change.devices) {
    const held = devices.get(row.id);
    devices.set(row.id, held === undefined ? row : mergeDevice(held, row));
  }

  return { activities, blocks, settings, devices };
}

/** For sorting rows by id. Two rows of one kind never have the same id. */
const compareIds = (first: { id: string }, second: { id: string }): number =>
  first.id < second.id ? -1 : 1;

/** Every row, sorted by id, so the same rows always give the same snapshot. */
export const takeSnapshot = (rows: Rows): Change => ({
  version: FORMAT_VERSION,
  activities: rows.activities.values().toArray().toSorted(compareIds),
  blocks: rows.blocks.values().toArray().toSorted(compareIds),
  settings: rows.settings,
  devices: rows.devices.values().toArray().toSorted(compareIds),
});

/** Every stamp in a change: each register's, row by row, named one by one so the types say so. */
function* listStamps(change: Change): Generator<Stamp> {
  for (const row of change.activities) {
    yield row.name.stamp;
    yield row.hue.stamp;
    yield row.shape.stamp;
    yield row.budget.stamp;
    yield row.order.stamp;
    yield row.existence.stamp;
  }

  for (const row of change.blocks) {
    yield row.time.stamp;
    yield row.existence.stamp;
  }

  for (const row of change.devices) {
    yield row.identity.stamp;
    yield row.name.stamp;
    yield row.membership.stamp;
  }

  if (change.settings === null) return;

  yield change.settings.dayStart.stamp;
  yield change.settings.dayEnd.stamp;
  yield change.settings.exampleLoadedAt.stamp;
}

/** The latest stamp in a change, which the node's clock moves on to once it's merged. */
export const findLatestStamp = (change: Change): Stamp =>
  listStamps(change).reduce(
    (latest, stamp) => (compareStamps(stamp, latest) > 0 ? stamp : latest),
    LOWEST,
  );

/**
 * The plan the rows show: the activities that aren't deleted, in order of their order keys and
 * then their ids, and the blocks that aren't deleted and whose activity is there and isn't either,
 * by id. Every value was checked when it was written or received, so the plan is valid as it is.
 */
export function readPlan(rows: Rows): Plan {
  const activities = rows.activities
    .values()
    .filter((row) => !row.existence.value.isDeleted)
    .toArray()
    .toSorted((first, second) =>
      compareOrder(
        { key: first.order.value, id: first.id },
        { key: second.order.value, id: second.id },
      ),
    );
  const living = new Set(activities.values().map((row) => row.id));
  const blocks = rows.blocks
    .values()
    .filter((row) => !row.existence.value.isDeleted && living.has(row.existence.value.activityId))
    .toArray()
    .toSorted(compareIds);
  return {
    version: 1,
    activities: activities.map((row) => ({
      id: row.id,
      name: row.name.value,
      hue: row.hue.value,
      shape: row.shape.value,
      mode: row.budget.value.mode,
      budgetMinutes: row.budget.value.budgetMinutes,
      days: row.budget.value.days,
    })),
    blocks: blocks.map((row) => ({
      id: row.id,
      activityId: row.existence.value.activityId,
      day: row.time.value.day,
      start: row.time.value.start,
      length: row.time.value.length,
    })),
    dayStart: rows.settings.dayStart.value,
    dayEnd: rows.settings.dayEnd.value,
    exampleLoadedAt: rows.settings.exampleLoadedAt.value,
  };
}

/** A register written before stamps existed: any real change is later. */
const createUnstamped = <Of>(value: Of): { value: Of; stamp: Stamp } => ({ value, stamp: LOWEST });

/**
 * The rows of a plan stored before stamps existed: every register gets the lowest stamp, and the
 * activities evenly spread order keys in their order (see Storage in docs/spec/merge.md). A block
 * whose activity isn't in the plan is left out, as `sanitizePlan` leaves it out: as a row it would
 * make every snapshot of this node one that the others refuse, for a block nobody can see.
 */
export function convertPlan(plan: Plan): Rows {
  const keys = spread(plan.activities.length);
  const activities = new Map<ActivityId, ActivityRow>();
  for (const [index, activity] of plan.activities.entries()) {
    const key = keys[index];
    if (key === undefined) throw new RangeError("spread() gave fewer keys than activities.");

    activities.set(activity.id, {
      id: activity.id,
      name: createUnstamped(activity.name),
      hue: createUnstamped(activity.hue),
      shape: createUnstamped(activity.shape),
      budget: createUnstamped({
        mode: activity.mode,
        budgetMinutes: activity.budgetMinutes,
        days: activity.days,
      }),
      order: createUnstamped(key),
      existence: createUnstamped({ isDeleted: false }),
    });
  }

  const blocks = new Map<BlockId, BlockRow>(
    plan.blocks
      .values()
      .filter((block) => activities.has(block.activityId))
      .map((block) => [
        block.id,
        {
          id: block.id,
          time: createUnstamped({ day: block.day, start: block.start, length: block.length }),
          existence: createUnstamped({ activityId: block.activityId, isDeleted: false }),
        },
      ]),
  );
  return {
    activities,
    blocks,
    settings: {
      dayStart: createUnstamped(plan.dayStart),
      dayEnd: createUnstamped(plan.dayEnd),
      exampleLoadedAt: createUnstamped(plan.exampleLoadedAt),
    },
    devices: new Map(),
  };
}
