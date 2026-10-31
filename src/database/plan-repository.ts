import type { BatchItem } from "drizzle-orm/batch";
import { asc, eq, inArray } from "drizzle-orm";

import type { IdGenerator } from "../plan/id.ts";
import { sanitizePlan } from "../plan/sanitize.ts";
import type { Activity } from "../plan/activity/index.ts";
import type { Block } from "../plan/block/index.ts";
import type { Plan } from "../plan/index.ts";
import type { Database } from "./drizzle.ts";
import { activities, blocks, settings } from "./schema.ts";

const SETTINGS_ID = 1;

/**
 * Reads the plan. `isStored` is false when the database has never held a plan (first run), so the
 * caller can load the example week. The database's constraints keep the ids valid, but anything
 * read is sanitized all the same, so `ids` gives the new ones it would need.
 */
export async function loadPlan(
  database: Database,
  ids: IdGenerator,
): Promise<{ plan: Plan; isStored: boolean }> {
  const [row, activityRows, blockRows] = await Promise.all([
    database.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get(),
    database.select().from(activities).orderBy(asc(activities.position)),
    database.select().from(blocks),
  ]);
  const plan = sanitizePlan(
    {
      version: 1,
      activities: activityRows,
      blocks: blockRows,
      dayStart: row?.dayStart,
      dayEnd: row?.dayEnd,
      exampleLoadedAt: row?.exampleLoadedAt,
    },
    ids,
  );
  return { plan, isStored: row !== undefined };
}

const isSameActivity = (
  previous: Activity,
  next: Activity,
  previousPosition: number,
  nextPosition: number,
): boolean =>
  previousPosition === nextPosition &&
  previous.name === next.name &&
  previous.hue === next.hue &&
  previous.shape === next.shape &&
  previous.mode === next.mode &&
  previous.budgetMinutes === next.budgetMinutes &&
  previous.days === next.days;

const isSameBlock = (previous: Block, next: Block): boolean =>
  previous.activityId === next.activityId &&
  previous.day === next.day &&
  previous.start === next.start &&
  previous.length === next.length;

/**
 * The statements that turn the stored `before` into `after`: deletes first (a deleted activity's
 * blocks before the activity), then upserts. Only what changed is written, and rows it creates
 * are created at `now`.
 */
export function buildPlanStatements(
  database: Database,
  before: Plan | undefined,
  after: Plan,
  now: Temporal.Instant,
): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];
  const createdAt = now.toString();

  const beforeActivities = new Map(
    before?.activities.map((activity, index) => [activity.id, { activity, index }]),
  );
  const afterActivityIds = new Set(after.activities.map((activity) => activity.id));
  const beforeBlocks = new Map(before?.blocks.map((block) => [block.id, block]));
  const afterBlockIds = new Set(after.blocks.map((block) => block.id));

  const removedActivities = beforeActivities
    .keys()
    .filter((id) => !afterActivityIds.has(id))
    .toArray();
  const removedBlocks = beforeBlocks
    .keys()
    .filter((id) => !afterBlockIds.has(id))
    .toArray();
  if (removedBlocks.length > 0)
    statements.push(database.delete(blocks).where(inArray(blocks.id, removedBlocks)));
  if (removedActivities.length > 0) {
    // Blocks of a deleted activity go with it, whether or not `after` still lists them.
    statements.push(
      database.delete(blocks).where(inArray(blocks.activityId, removedActivities)),
      database.delete(activities).where(inArray(activities.id, removedActivities)),
    );
  }

  after.activities.forEach((activity, position) => {
    const previous = beforeActivities.get(activity.id);
    if (previous && isSameActivity(previous.activity, activity, previous.index, position)) return;
    const values = {
      name: activity.name,
      hue: activity.hue,
      shape: activity.shape,
      mode: activity.mode,
      budgetMinutes: activity.budgetMinutes,
      days: activity.days,
      position,
    };
    statements.push(
      database
        .insert(activities)
        .values({ id: activity.id, createdAt, ...values })
        .onConflictDoUpdate({ target: activities.id, set: values }),
    );
  });

  for (const block of after.blocks) {
    const previous = beforeBlocks.get(block.id);
    if (previous && isSameBlock(previous, block)) continue;
    const values = {
      activityId: block.activityId,
      day: block.day,
      start: block.start,
      length: block.length,
    };
    statements.push(
      database
        .insert(blocks)
        .values({ id: block.id, ...values })
        .onConflictDoUpdate({ target: blocks.id, set: values }),
    );
  }

  if (
    !before ||
    before.dayStart !== after.dayStart ||
    before.dayEnd !== after.dayEnd ||
    before.exampleLoadedAt !== after.exampleLoadedAt
  ) {
    const values = {
      dayStart: after.dayStart,
      dayEnd: after.dayEnd,
      exampleLoadedAt: after.exampleLoadedAt,
    };
    statements.push(
      database
        .insert(settings)
        .values({ id: SETTINGS_ID, ...values })
        .onConflictDoUpdate({ target: settings.id, set: values }),
    );
  }
  return statements;
}

/**
 * Writes one user action: everything that differs between `before` (what is stored) and `after`,
 * in one transaction, at `now`. Undo uses the same path, with the restored plan as `after`.
 */
export async function savePlan(
  database: Database,
  before: Plan | undefined,
  after: Plan,
  now: Temporal.Instant,
): Promise<void> {
  const [first, ...rest] = buildPlanStatements(database, before, after, now);
  if (first) await database.batch([first, ...rest]);
}
