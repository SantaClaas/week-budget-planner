import type { BatchItem } from "drizzle-orm/batch";
import { asc, eq, inArray } from "drizzle-orm";

import { sanitizePlan } from "../plan/sanitize";
import type { Activity, Block, Plan } from "../plan/types";
import type { Theme } from "../theme";
import type { Database } from "./drizzle";
import { activities, blocks, settings } from "./schema";

const SETTINGS_ID = 1;

/**
 * Reads the plan. `isStored` is false when the database has never held a plan (first run), so the
 * caller can load the example week.
 */
export async function loadPlan(database: Database): Promise<{ plan: Plan; isStored: boolean }> {
  const [row, activityRows, blockRows] = await Promise.all([
    database.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get(),
    database.select().from(activities).orderBy(asc(activities.position)),
    database.select().from(blocks),
  ]);
  const plan = sanitizePlan({
    version: 1,
    activities: activityRows,
    blocks: blockRows,
    dayStart: row?.dayStart,
    dayEnd: row?.dayEnd,
    exampleLoadedAt: row?.exampleLoadedAt,
  });
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
 * blocks before the activity), then upserts. Only what changed is written.
 */
export function buildPlanStatements(database: Database, before: Plan | undefined, after: Plan): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];
  const now = new Date().toISOString();

  const beforeActivities = new Map(before?.activities.map((activity, index) => [activity.id, { activity, index }]));
  const afterActivityIds = new Set(after.activities.map((activity) => activity.id));
  const beforeBlocks = new Map(before?.blocks.map((block) => [block.id, block]));
  const afterBlockIds = new Set(after.blocks.map((block) => block.id));

  const removedActivities = [...beforeActivities.keys()].filter((id) => !afterActivityIds.has(id));
  const removedBlocks = [...beforeBlocks.keys()].filter((id) => !afterBlockIds.has(id));
  if (removedBlocks.length) statements.push(database.delete(blocks).where(inArray(blocks.id, removedBlocks)));
  if (removedActivities.length) {
    // Blocks of a deleted activity go with it, whether or not `after` still lists them.
    statements.push(database.delete(blocks).where(inArray(blocks.activityId, removedActivities)));
    statements.push(database.delete(activities).where(inArray(activities.id, removedActivities)));
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
        .values({ id: activity.id, createdAt: now, ...values })
        .onConflictDoUpdate({ target: activities.id, set: values }),
    );
  });

  for (const block of after.blocks) {
    const previous = beforeBlocks.get(block.id);
    if (previous && isSameBlock(previous, block)) continue;
    const values = { activityId: block.activityId, day: block.day, start: block.start, length: block.length };
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
    const values = { dayStart: after.dayStart, dayEnd: after.dayEnd, exampleLoadedAt: after.exampleLoadedAt };
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
 * in one transaction. Undo uses the same path, with the restored plan as `after`.
 */
export async function savePlan(database: Database, before: Plan | undefined, after: Plan): Promise<void> {
  const [first, ...rest] = buildPlanStatements(database, before, after);
  if (first) await database.batch([first, ...rest]);
}

export async function loadTheme(database: Database): Promise<Theme> {
  const row = await database.select({ theme: settings.theme }).from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  return row?.theme ?? "system";
}

/** Stores the theme choice. Creates the settings row with default day hours if there is none yet. */
export async function saveTheme(database: Database, theme: Theme): Promise<void> {
  await database
    .insert(settings)
    .values({ id: SETTINGS_ID, dayStart: 7, dayEnd: 22, exampleLoadedAt: null, theme })
    .onConflictDoUpdate({ target: settings.id, set: { theme } });
}
