import type { BatchItem } from "drizzle-orm/batch";
import { eq } from "drizzle-orm";

import { make } from "../merge/change.ts";
import { issueNext } from "../merge/clock.ts";
import { convertPlan, readPlan, type Change, type Rows } from "../merge/index.ts";
import type { ActivityRow, BlockRow, SettingsRow } from "../merge/row.ts";
import { LOWEST, sanitizeTime, type NodeId, type Stamp } from "../merge/stamp.ts";
import type { ActivityId, BlockId, IdGenerator } from "../plan/id.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { sanitizePlan } from "../plan/sanitize.ts";
import type { Database } from "./drizzle.ts";
import { activities, blocks, node, settings } from "./schema.ts";

/** The id of the one row of the settings and the node tables. */
const SINGLE_ROW_ID = 1;

type ActivityRecord = typeof activities.$inferSelect;
type BlockRecord = typeof blocks.$inferSelect;
type SettingsRecord = typeof settings.$inferSelect;

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

/** This browser's node: its id and its clock, once the first save has made them. */
type StoredNode = { nodeId: NodeId; clock: Stamp };

/**
 * Reads every row, deleted ones too, and this browser's node. The database's `CHECK` constraints
 * hold every value to the same rules as the merge's strict check, and its foreign key keeps every
 * block's activity row there, so the rows are taken as they are.
 *
 * @returns The rows, whether the database has ever held a plan (a settings row), and the node, or
 *   undefined before the first save.
 */
export async function loadRows(
  database: Database,
): Promise<{ rows: Rows; isStored: boolean; node: StoredNode | undefined }> {
  const [settingsRecord, activityRecords, blockRecords, nodeRecord] = await Promise.all([
    database.select().from(settings).where(eq(settings.id, SINGLE_ROW_ID)).get(),
    database.select().from(activities),
    database.select().from(blocks),
    database.select().from(node).where(eq(node.id, SINGLE_ROW_ID)).get(),
  ]);
  const rows: Rows = {
    activities: new Map<ActivityId, ActivityRow>(
      activityRecords.values().map((record) => [record.id, readActivity(record)]),
    ),
    blocks: new Map<BlockId, BlockRow>(
      blockRecords.values().map((record) => [record.id, readBlock(record)]),
    ),
    settings: readSettings(settingsRecord),
  };
  return {
    rows,
    isStored: settingsRecord !== undefined,
    node: nodeRecord && { nodeId: nodeRecord.nodeId, clock: nodeRecord.clock },
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

/**
 * The statements that write a change's rows and the node's clock: each row whole, inserted or, when
 * it's there, updated. A new activity's row is created at `now`.
 */
export function buildChangeStatements(
  database: Database,
  change: Change,
  stored: StoredNode,
  now: Temporal.Instant,
): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];
  for (const row of change.activities) {
    const values = {
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
 * the node, stamps what the action changed with the node's next stamp, and writes the touched rows
 * and the clock in one batch. The read and the write are two calls, so the caller makes sure no
 * other save runs in between, as the database store does with a lock.
 *
 * @param database - The database, through the leader tab or directly.
 * @param update - The action: it gets the plan the rows show and gives back the plan after.
 * @param now - When the action happened (see "One action, one `now`" in
 *   docs/guidelines/principles.md).
 * @param createNodeId - Makes this browser's node id, on the first save.
 * @returns The plan the rows show after the action.
 * @throws {Error} When the node's clock is at the latest stamp there is, which only a broken
 *   device brings it to: the action can't be stamped, and the caller reports the failed save.
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

  const made = make(loaded.rows, update, stamp);
  const [first, ...rest] = buildChangeStatements(
    database,
    made.change,
    { nodeId, clock: stamp },
    now,
  );
  if (first) await database.batch([first, ...rest]);

  return readPlan(made.rows);
}
