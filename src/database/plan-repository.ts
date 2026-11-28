import type { BatchItem } from "drizzle-orm/batch";
import { eq } from "drizzle-orm";

import { make } from "../merge/change.ts";
import { advance, issueNext } from "../merge/clock.ts";
import { convertPlan, readPlan, type Change, type Rows } from "../merge/index.ts";
import type { DeviceKey } from "../device/index.ts";
import type { ActivityRow, BlockRow, DeviceRow, SettingsRow } from "../merge/row.ts";
import { LOWEST, sanitizeTime, type NodeId, type Stamp } from "../merge/stamp.ts";
import type { ActivityId, BlockId, IdGenerator } from "../plan/id.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { sanitizePlan } from "../plan/sanitize.ts";
import {
  NO_CHANGE,
  createEmptyOrigins,
  findLatestChange,
  incrementChangeNumber,
  noteAction,
  type ChangeNumber,
  type Origin,
  type Origins,
} from "../sync/origin.ts";
import type { Database } from "./drizzle.ts";
import { activities, blocks, devices, node, progress, settings } from "./schema.ts";

/** The id of the one row of the settings and the node tables. */
const SINGLE_ROW_ID = 1;

type ActivityRecord = typeof activities.$inferSelect;
type BlockRecord = typeof blocks.$inferSelect;
type SettingsRecord = typeof settings.$inferSelect;
type DeviceRecord = typeof devices.$inferSelect;

const readOrigin = (record: { changedAt: ChangeNumber; changedBy: DeviceKey | null }): Origin => ({
  changedAt: record.changedAt,
  changedBy: record.changedBy,
});

const readActivity = (record: ActivityRecord): ActivityRow => ({
  id: record.id,
  name: { value: record.name, stamp: record.nameStamp },
  hue: { value: record.hue, stamp: record.hueStamp },
  shape: { value: record.shape, stamp: record.shapeStamp },
  budget: {
    value: { mode: record.mode, budgetMinutes: record.budgetMinutes, days: record.days },
    stamp: record.budgetStamp,
  },
  order: { value: record.orderKey, stamp: record.orderStamp },
  existence: { value: { isDeleted: record.isDeleted }, stamp: record.existenceStamp },
});

const readBlock = (record: BlockRecord): BlockRow => ({
  id: record.id,
  time: {
    value: { day: record.day, start: record.start, length: record.length },
    stamp: record.timeStamp,
  },
  existence: {
    value: { activityId: record.activityId, isDeleted: record.isDeleted },
    stamp: record.existenceStamp,
  },
});

/** The settings row, or the settings of an empty plan with the lowest stamps when none is stored. */
const readSettings = (record: SettingsRecord | undefined): SettingsRow =>
  record === undefined
    ? convertPlan(createEmptyPlan()).settings
    : {
        dayStart: { value: record.dayStart, stamp: record.dayStartStamp },
        dayEnd: { value: record.dayEnd, stamp: record.dayEndStamp },
        exampleLoadedAt: { value: record.exampleLoadedAt, stamp: record.exampleLoadedAtStamp },
      };

const readDevice = (record: DeviceRecord): DeviceRow => ({
  id: record.id,
  identity: { value: { relay: record.relay }, stamp: record.identityStamp },
  name: { value: record.name, stamp: record.nameStamp },
  membership: {
    value: { status: record.status, proof: record.proof },
    stamp: record.membershipStamp,
  },
});

/**
 * This browser's node: its id, its clock and its counter (see What a device keeps for syncing in
 * docs/spec/self-service.md), once the first save has made them.
 */
export type StoredNode = { nodeId: NodeId; clock: Stamp; counter: ChangeNumber };

/** The higher of two counters, which can't go back. */
const findHigher = (first: ChangeNumber, second: ChangeNumber): ChangeNumber =>
  first > second ? first : second;

/** Reads this browser's node, or undefined before the first save. */
export async function loadNode(database: Database): Promise<StoredNode | undefined> {
  const record = await database.select().from(node).where(eq(node.id, SINGLE_ROW_ID)).get();
  return record && { nodeId: record.nodeId, clock: record.clock, counter: record.counter };
}

/**
 * Reads every row, deleted ones too, and this browser's node. The database's `CHECK` constraints
 * hold every value to the same rules as the merge's strict check, and its foreign key keeps every
 * block's activity row there, so the rows are taken as they are.
 *
 * @returns The rows, their origins, whether the database has ever held a plan (a settings row),
 *   the node, or undefined before the first save, and the counter: the node's, but never below the
 *   latest change of a row, which rows migrated before the first save have without a node.
 */
export async function loadRows(database: Database): Promise<{
  rows: Rows;
  origins: Origins;
  isStored: boolean;
  node: StoredNode | undefined;
  counter: ChangeNumber;
}> {
  const [settingsRecord, activityRecords, blockRecords, deviceRecords, stored] = await Promise.all([
    database.select().from(settings).where(eq(settings.id, SINGLE_ROW_ID)).get(),
    database.select().from(activities),
    database.select().from(blocks),
    database.select().from(devices),
    loadNode(database),
  ]);
  const rows: Rows = {
    activities: new Map<ActivityId, ActivityRow>(
      activityRecords.values().map((record) => [record.id, readActivity(record)]),
    ),
    blocks: new Map<BlockId, BlockRow>(
      blockRecords.values().map((record) => [record.id, readBlock(record)]),
    ),
    settings: readSettings(settingsRecord),
    devices: new Map<DeviceKey, DeviceRow>(
      deviceRecords.values().map((record) => [record.id, readDevice(record)]),
    ),
  };
  const origins: Origins = {
    activities: new Map(activityRecords.values().map((record) => [record.id, readOrigin(record)])),
    blocks: new Map(blockRecords.values().map((record) => [record.id, readOrigin(record)])),
    settings:
      settingsRecord === undefined ? createEmptyOrigins().settings : readOrigin(settingsRecord),
    devices: new Map(deviceRecords.values().map((record) => [record.id, readOrigin(record)])),
  };
  return {
    rows,
    origins,
    isStored: settingsRecord !== undefined,
    node: stored,
    counter: findHigher(stored?.counter ?? NO_CHANGE, findLatestChange(origins)),
  };
}

/**
 * Reads the plan the rows show. `isStored` is false when the database has never held a plan (first
 * run), so the caller can load the example week. The plan is sanitized all the same, as everything
 * loaded is, so `ids` gives the new ones it would need.
 */
export async function loadPlan(
  database: Database,
  ids: IdGenerator,
): Promise<{ plan: Plan; isStored: boolean }> {
  const { rows, isStored } = await loadRows(database);
  return { plan: sanitizePlan(readPlan(rows), ids), isStored };
}

/** A row's origin, which the write being built has noted. */
function requireOrigin<Key>(origins: ReadonlyMap<Key, Origin>, key: Key): Origin {
  const origin = origins.get(key);
  if (origin === undefined) throw new Error(`A row to write has no origin: ${String(key)}.`);

  return origin;
}

/**
 * The statements that write a change's rows, with their origins, and the node: each row whole,
 * inserted or, when it's there, updated. A new activity's row is created at `now`.
 *
 * @param change - The rows as they are after the write, merged: each overwrites the row stored. A
 *   change as it was received must be merged into the rows first (see `merge()`), and only the
 *   rows that merge altered written, or older registers would replace newer ones.
 * @param origins - The origins after the write, which hold one for every row in the change.
 */
export function buildChangeStatements(
  database: Database,
  change: Change,
  origins: Origins,
  stored: StoredNode,
  now: Temporal.Instant,
): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];
  for (const row of change.activities) {
    const values = {
      ...requireOrigin(origins.activities, row.id),
      name: row.name.value,
      nameStamp: row.name.stamp,
      hue: row.hue.value,
      hueStamp: row.hue.stamp,
      shape: row.shape.value,
      shapeStamp: row.shape.stamp,
      mode: row.budget.value.mode,
      budgetMinutes: row.budget.value.budgetMinutes,
      days: row.budget.value.days,
      budgetStamp: row.budget.stamp,
      orderKey: row.order.value,
      orderStamp: row.order.stamp,
      isDeleted: row.existence.value.isDeleted,
      existenceStamp: row.existence.stamp,
    };
    statements.push(
      database
        .insert(activities)
        .values({ id: row.id, createdAt: now.toString(), ...values })
        .onConflictDoUpdate({ target: activities.id, set: values }),
    );
  }

  for (const row of change.blocks) {
    const values = {
      ...requireOrigin(origins.blocks, row.id),
      activityId: row.existence.value.activityId,
      isDeleted: row.existence.value.isDeleted,
      existenceStamp: row.existence.stamp,
      day: row.time.value.day,
      start: row.time.value.start,
      length: row.time.value.length,
      timeStamp: row.time.stamp,
    };
    statements.push(
      database
        .insert(blocks)
        .values({ id: row.id, ...values })
        .onConflictDoUpdate({ target: blocks.id, set: values }),
    );
  }

  if (change.settings !== null) {
    const values = {
      ...origins.settings,
      dayStart: change.settings.dayStart.value,
      dayStartStamp: change.settings.dayStart.stamp,
      dayEnd: change.settings.dayEnd.value,
      dayEndStamp: change.settings.dayEnd.stamp,
      exampleLoadedAt: change.settings.exampleLoadedAt.value,
      exampleLoadedAtStamp: change.settings.exampleLoadedAt.stamp,
    };
    statements.push(
      database
        .insert(settings)
        .values({ id: SINGLE_ROW_ID, ...values })
        .onConflictDoUpdate({ target: settings.id, set: values }),
    );
  }

  for (const row of change.devices) {
    const values = {
      ...requireOrigin(origins.devices, row.id),
      relay: row.identity.value.relay,
      identityStamp: row.identity.stamp,
      name: row.name.value,
      nameStamp: row.name.stamp,
      status: row.membership.value.status,
      proof: row.membership.value.proof,
      membershipStamp: row.membership.stamp,
    };
    statements.push(
      database
        .insert(devices)
        .values({ id: row.id, ...values })
        .onConflictDoUpdate({ target: devices.id, set: values }),
    );
  }

  statements.push(
    database
      .insert(node)
      .values({ id: SINGLE_ROW_ID, ...stored })
      .onConflictDoUpdate({ target: node.id, set: stored }),
  );
  return statements;
}

/**
 * Saves one user action through the rows (see Storage in docs/spec/merge.md): reads the rows and
 * the node, stamps what the action changed with the node's next stamp, numbers the write with the
 * counter's next value, and writes the touched rows, their origins, the clock and the counter in
 * one batch. The read and the write are two calls, so the caller makes sure no
 * other save runs in between, as the database store does with a lock.
 *
 * @param database - The database, through the leader tab or directly.
 * @param update - The action: it gets the plan the rows show and gives back the plan after.
 * @param now - When the action happened (see "One action, one `now`" in
 *   docs/guidelines/principles.md).
 * @param createNodeId - Makes this browser's node id, on the first save.
 * @returns The plan the rows show after the action.
 * @throws {Error} When the node's clock is at the latest stamp there is, or its counter at the
 *   highest number, which only a broken device brings it to: the action can't be stamped, and the
 *   caller reports the failed save.
 */
export async function saveAction(
  database: Database,
  update: (before: Plan) => Plan,
  now: Temporal.Instant,
  createNodeId: () => NodeId,
): Promise<Plan> {
  const loaded = await loadRows(database);
  const nodeId = loaded.node?.nodeId ?? createNodeId();
  const stamp = issueNext(loaded.node?.clock ?? LOWEST, sanitizeTime(now), nodeId);
  if (stamp === undefined) throw new Error("This device's clock is at the latest stamp there is.");

  const counter = incrementChangeNumber(loaded.counter);
  if (counter === "out-of-range") throw new Error("This device's counter is at its highest.");

  const made = make(loaded.rows, update, stamp);
  const origins = noteAction(loaded.rows, made.rows, loaded.origins, counter);
  const [first, ...rest] = buildChangeStatements(
    database,
    made.change,
    origins,
    { nodeId, clock: stamp, counter },
    now,
  );
  if (first) await database.batch([first, ...rest]);

  return readPlan(made.rows);
}

/**
 * Gives an imported database's node a new id, the later of two clocks and a counter above both
 * (see Export and import in docs/spec/merge.md). With the file's id, two browsers that imported
 * the same file would issue stamps under one id, and two different values could get the same
 * stamp. With the earlier clock, this browser's next stamp could be earlier than one it issued
 * before the import.
 *
 * The import replaces this browser's rows, so every row counts as changed here, at the new
 * counter, and every other device gets them all: one that had this browser's changes up to its old
 * counter, or the file's, would otherwise miss rows the import brought. The file's progress was
 * another device's, so it goes, also from a file without a node, which a crafted one can be.
 *
 * @param database - The imported database, migrated.
 * @param before - This browser's clock and counter before the import, or undefined before its
 *   first save.
 * @param nodeId - The new id.
 * @returns The node it wrote.
 * @throws {Error} When the counter is at its highest, which only a broken device brings it to.
 */
export async function renewNode(
  database: Database,
  before: { clock: Stamp; counter: ChangeNumber } | undefined,
  nodeId: NodeId,
): Promise<StoredNode> {
  const imported = await loadRows(database);
  const counter = incrementChangeNumber(findHigher(before?.counter ?? NO_CHANGE, imported.counter));
  if (counter === "out-of-range") throw new Error("This device's counter is at its highest.");

  const renewed = {
    nodeId,
    clock: advance(before?.clock ?? LOWEST, imported.node?.clock ?? LOWEST),
    counter,
  };
  const origin = { changedAt: counter, changedBy: null };
  await database.batch([
    database
      .insert(node)
      .values({ id: SINGLE_ROW_ID, ...renewed })
      .onConflictDoUpdate({ target: node.id, set: renewed }),
    database.update(activities).set(origin),
    database.update(blocks).set(origin),
    database.update(settings).set(origin),
    database.update(devices).set(origin),
    database.delete(progress),
  ]);
  return renewed;
}
