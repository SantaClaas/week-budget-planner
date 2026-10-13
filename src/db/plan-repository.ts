import type { BatchItem } from "drizzle-orm/batch";
import { asc, eq, inArray } from "drizzle-orm";

import { sanitizePlan } from "../plan/sanitize";
import type { Activity, Block, Plan } from "../plan/types";
import type { Theme } from "../storage/plan-store";
import type { Db } from "./drizzle";
import { activities, blocks, settings } from "./schema";

const SETTINGS_ID = 1;

/**
 * Reads the plan. `stored` is false when the database has never held a plan (first run), so the
 * caller can load the example week.
 */
export async function loadPlan(db: Db): Promise<{ plan: Plan; stored: boolean }> {
  const [row, activityRows, blockRows] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get(),
    db.select().from(activities).orderBy(asc(activities.position)),
    db.select().from(blocks),
  ]);
  const plan = sanitizePlan({
    v: 1,
    activities: activityRows,
    blocks: blockRows.map(({ activityId, ...block }) => ({ ...block, act: activityId })),
    dayStart: row?.dayStart,
    dayEnd: row?.dayEnd,
    example: row?.example,
  });
  return { plan, stored: row !== undefined };
}

const sameActivity = (a: Activity, b: Activity, aIndex: number, bIndex: number): boolean =>
  aIndex === bIndex &&
  a.name === b.name &&
  a.hue === b.hue &&
  a.shape === b.shape &&
  a.mode === b.mode &&
  a.mins === b.mins &&
  a.days === b.days;

const sameBlock = (a: Block, b: Block): boolean =>
  a.act === b.act && a.day === b.day && a.start === b.start && a.dur === b.dur;

/**
 * The statements that turn the stored `before` into `after`: deletes first (a deleted activity's
 * blocks before the activity), then upserts. Only what changed is written.
 */
export function planStatements(db: Db, before: Plan | undefined, after: Plan): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];
  const now = new Date().toISOString();

  const beforeActivities = new Map(before?.activities.map((activity, index) => [activity.id, { activity, index }]));
  const afterActivityIds = new Set(after.activities.map((activity) => activity.id));
  const beforeBlocks = new Map(before?.blocks.map((block) => [block.id, block]));
  const afterBlockIds = new Set(after.blocks.map((block) => block.id));

  const removedActivities = [...beforeActivities.keys()].filter((id) => !afterActivityIds.has(id));
  const removedBlocks = [...beforeBlocks.keys()].filter((id) => !afterBlockIds.has(id));
  if (removedBlocks.length) statements.push(db.delete(blocks).where(inArray(blocks.id, removedBlocks)));
  if (removedActivities.length) {
    // Blocks of a deleted activity go with it, whether or not `after` still lists them.
    statements.push(db.delete(blocks).where(inArray(blocks.activityId, removedActivities)));
    statements.push(db.delete(activities).where(inArray(activities.id, removedActivities)));
  }

  after.activities.forEach((activity, position) => {
    const previous = beforeActivities.get(activity.id);
    if (previous && sameActivity(previous.activity, activity, previous.index, position)) return;
    const values = {
      name: activity.name,
      hue: activity.hue,
      shape: activity.shape,
      mode: activity.mode,
      mins: activity.mins,
      days: activity.days,
      position,
    };
    statements.push(
      db
        .insert(activities)
        .values({ id: activity.id, createdAt: now, ...values })
        .onConflictDoUpdate({ target: activities.id, set: values }),
    );
  });

  for (const block of after.blocks) {
    const previous = beforeBlocks.get(block.id);
    if (previous && sameBlock(previous, block)) continue;
    const values = { activityId: block.act, day: block.day, start: block.start, dur: block.dur };
    statements.push(
      db
        .insert(blocks)
        .values({ id: block.id, ...values })
        .onConflictDoUpdate({ target: blocks.id, set: values }),
    );
  }

  if (
    !before ||
    before.dayStart !== after.dayStart ||
    before.dayEnd !== after.dayEnd ||
    before.example !== after.example
  ) {
    const values = { dayStart: after.dayStart, dayEnd: after.dayEnd, example: after.example };
    statements.push(
      db
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
export async function savePlan(db: Db, before: Plan | undefined, after: Plan): Promise<void> {
  const [first, ...rest] = planStatements(db, before, after);
  if (first) await db.batch([first, ...rest]);
}

export async function loadTheme(db: Db): Promise<Theme> {
  const row = await db.select({ theme: settings.theme }).from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  return row?.theme ?? "system";
}

/** Stores the theme choice. Creates the settings row with default day hours if there is none yet. */
export async function saveTheme(db: Db, theme: Theme): Promise<void> {
  await db
    .insert(settings)
    .values({ id: SETTINGS_ID, dayStart: 7, dayEnd: 22, example: false, theme })
    .onConflictDoUpdate({ target: settings.id, set: { theme } });
}
