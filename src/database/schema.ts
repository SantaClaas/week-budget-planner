import { sql, type SQL } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import { MAX_NAME_CHARACTERS, type ActivityName } from "../plan/activity-name.ts";
import type { ActivityId, BlockId } from "../plan/id.ts";
import {
  DAY,
  MAX_LENGTH,
  SLOT,
  WEEK,
  type BudgetMinutes,
  type DayCount,
  type DayIndex,
  type DayMinute,
  type Hour,
  type Length,
} from "../plan/time.ts";
import { PALETTE, SHAPES, type Hue, type Shape } from "../plan/types.ts";

// The columns hold the plan's branded values, and CHECK constraints enforce the same rules as their
// sanitizers (see docs/spec/data-model.md), so nothing that skipped the types can be stored.

/** A constant as SQL text. Constraints are DDL, which can't take parameters. */
const quote = (value: number | string): string =>
  typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const literal = (value: number | string): SQL => sql.raw(quote(value));
const list = (values: readonly (number | string)[]): SQL =>
  sql.raw(values.map((value) => quote(value)).join(", "));

const isBetween = (column: AnySQLiteColumn, low: number, high: number): SQL =>
  sql`${column} BETWEEN ${literal(low)} AND ${literal(high)}`;
const isSlotMultiple = (column: AnySQLiteColumn): SQL => sql`${column} % ${literal(SLOT)} = 0`;
const isIdLength = (column: AnySQLiteColumn): SQL => sql`length(${column}) BETWEEN 1 AND 40`;

/** Activities in list order (`position`). Times and budgets are integer minutes. */
export const activities = sqliteTable(
  "activities",
  {
    id: text().$type<ActivityId>().primaryKey(),
    name: text().$type<ActivityName>().notNull(),
    hue: integer().$type<Hue>().notNull(),
    shape: text().$type<Shape>().notNull(),
    mode: text({ enum: ["week", "day"] }).notNull(),
    budgetMinutes: integer("budget_minutes").$type<BudgetMinutes>().notNull(),
    days: integer().$type<DayCount>().notNull(),
    position: integer().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("activities_id", isIdLength(table.id)),
    check(
      "activities_name",
      sql`length(${table.name}) BETWEEN 1 AND ${literal(MAX_NAME_CHARACTERS)}`,
    ),
    check("activities_hue", sql`${table.hue} IN (${list(PALETTE.map((color) => color.hue))})`),
    check("activities_shape", sql`${table.shape} IN (${list(SHAPES)})`),
    check("activities_mode", sql`${table.mode} IN ('week', 'day')`),
    check(
      "activities_budget_minutes",
      // Spelled out with AND and OR: a STRICT table refuses a CASE here, whose type it can't tell.
      sql`${isSlotMultiple(table.budgetMinutes)} AND ${table.budgetMinutes} >= ${literal(SLOT)} AND ((${table.mode} = 'day' AND ${table.budgetMinutes} <= ${literal(DAY)}) OR (${table.mode} = 'week' AND ${table.budgetMinutes} <= ${literal(WEEK)}))`,
    ),
    check("activities_days", isBetween(table.days, 1, 7)),
  ],
);

/** Blocks on the week. Deleting an activity deletes its blocks in the same transaction. */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text().$type<BlockId>().primaryKey(),
    activityId: text("activity_id")
      .$type<ActivityId>()
      .notNull()
      .references(() => activities.id),
    day: integer().$type<DayIndex>().notNull(),
    start: integer().$type<DayMinute>().notNull(),
    length: integer().$type<Length>().notNull(),
  },
  (table) => [
    index("blocks_activity_id").on(table.activityId),
    check("blocks_id", isIdLength(table.id)),
    check("blocks_day", isBetween(table.day, 0, 6)),
    check(
      "blocks_start",
      sql`${isBetween(table.start, 0, DAY - SLOT)} AND ${isSlotMultiple(table.start)}`,
    ),
    check(
      "blocks_length",
      sql`${isBetween(table.length, SLOT, MAX_LENGTH)} AND ${isSlotMultiple(table.length)}`,
    ),
  ],
);

/** A single row (id 1) with the week's settings. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer().primaryKey(),
    dayStart: integer("day_start").$type<Hour>().notNull(),
    dayEnd: integer("day_end").$type<Hour>().notNull(),
    /** When the example week was loaded (ISO 8601, UTC), null when there is none. */
    exampleLoadedAt: text("example_loaded_at"),
  },
  (table) => [
    check("settings_day_start", isBetween(table.dayStart, 0, 12)),
    check("settings_day_end", isBetween(table.dayEnd, 13, 24)),
  ],
);
