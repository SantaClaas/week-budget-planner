import { sql, type SQL } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

import type { OrderKey } from "../merge/order.ts";
import type { NodeId, Stamp } from "../merge/stamp.ts";
import { MAX_NAME_CHARACTERS, type ActivityName } from "../plan/activity/name.ts";
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
import { PALETTE, SHAPES, type Hue, type Shape } from "../plan/activity/look.ts";

// The columns hold the plan's branded values, and CHECK constraints enforce the same rules as their
// sanitizers (see docs/spec/data-model.md), so nothing that skipped the types can be stored.

/** A constant as SQL text. Constraints are DDL, which can't take parameters. */
const quote = (value: number | string): string =>
  typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const formatLiteral = (value: number | string): SQL => sql.raw(quote(value));
const formatList = (values: readonly (number | string)[]): SQL =>
  sql.raw(values.map((value) => quote(value)).join(", "));

const isBetween = (column: AnySQLiteColumn, low: number, high: number): SQL =>
  sql`${column} BETWEEN ${formatLiteral(low)} AND ${formatLiteral(high)}`;
const isSlotMultiple = (column: AnySQLiteColumn): SQL =>
  sql`${column} % ${formatLiteral(SLOT)} = 0`;
const isIdLength = (column: AnySQLiteColumn): SQL => sql`length(${column}) BETWEEN 1 AND 40`;

/** Text of letters and digits only. GLOB is case-sensitive, so the classes are exact. */
const isAlphanumeric = (column: AnySQLiteColumn): SQL => sql`${column} NOT GLOB '*[^0-9A-Za-z]*'`;

/**
 * A stamp's text form: 13 digits, a hyphen, 6 digits, a hyphen and a node id of 1 to 40 letters and
 * digits, or the lowest stamp, whose node id is empty (see merge/stamp.ts).
 */
const STAMP_PATTERN = sql.raw(`'${"[0-9]".repeat(13)}-${"[0-9]".repeat(6)}-?*'`);
const isStamp = (column: AnySQLiteColumn): SQL =>
  sql`(${column} = '0000000000000-000000-' OR (${column} GLOB ${STAMP_PATTERN} AND length(${column}) <= 61 AND substr(${column}, 22) NOT GLOB '*[^0-9A-Za-z]*'))`;

/** A stamp column, for the register it's named after (see Registers in docs/spec/merge.md). */
const createStampColumn = (name: string) => text(name).$type<Stamp>().notNull();

/**
 * A `CHECK` on the form of each stamp column of a table.
 *
 * @param table - The table's name, which starts each constraint's name.
 * @param columns - The stamp columns, by the name the constraint ends in.
 */
const checkStamps = (table: string, columns: Record<string, AnySQLiteColumn>) =>
  Object.entries(columns).map(([name, column]) => check(`${table}_${name}`, isStamp(column)));

/** An order key: 1 to 100 letters and digits, not ending in "0" (see merge/order.ts). */
const isOrderKey = (column: AnySQLiteColumn): SQL =>
  sql`length(${column}) BETWEEN 1 AND 100 AND ${isAlphanumeric(column)} AND ${column} NOT GLOB '*0'`;

/** A boolean, which a STRICT table keeps as the integer 0 or 1. */
const isBoolean = (column: AnySQLiteColumn): SQL => sql`${column} IN (0, 1)`;

/**
 * Every activity's row, deleted ones too, as deletion markers (see Storage in docs/spec/merge.md).
 * Each register's value sits beside its stamp; the budget's three fields share one. Times and
 * budgets are integer minutes. The list is sorted by `order_key`, then `id`.
 */
export const activities = sqliteTable(
  "activities",
  {
    id: text().$type<ActivityId>().primaryKey(),
    name: text().$type<ActivityName>().notNull(),
    nameStamp: createStampColumn("name_stamp"),
    hue: integer().$type<Hue>().notNull(),
    hueStamp: createStampColumn("hue_stamp"),
    shape: text().$type<Shape>().notNull(),
    shapeStamp: createStampColumn("shape_stamp"),
    mode: text({ enum: ["week", "day"] }).notNull(),
    budgetMinutes: integer("budget_minutes").$type<BudgetMinutes>().notNull(),
    days: integer().$type<DayCount>().notNull(),
    budgetStamp: createStampColumn("budget_stamp"),
    orderKey: text("order_key").$type<OrderKey>().notNull(),
    orderStamp: createStampColumn("order_stamp"),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull(),
    existenceStamp: createStampColumn("existence_stamp"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    ...checkStamps("activities", {
      name_stamp: table.nameStamp,
      hue_stamp: table.hueStamp,
      shape_stamp: table.shapeStamp,
      budget_stamp: table.budgetStamp,
      order_stamp: table.orderStamp,
      existence_stamp: table.existenceStamp,
    }),
    check("activities_order_key", isOrderKey(table.orderKey)),
    check("activities_is_deleted", isBoolean(table.isDeleted)),
    check("activities_id", isIdLength(table.id)),
    check(
      "activities_name",
      sql`length(${table.name}) BETWEEN 1 AND ${formatLiteral(MAX_NAME_CHARACTERS)}`,
    ),
    check(
      "activities_hue",
      sql`${table.hue} IN (${formatList(PALETTE.map((color) => color.hue))})`,
    ),
    check("activities_shape", sql`${table.shape} IN (${formatList(SHAPES)})`),
    check("activities_mode", sql`${table.mode} IN ('week', 'day')`),
    check(
      "activities_budget_minutes",
      // Spelled out with AND and OR: a STRICT table refuses a CASE here, whose type it can't tell.
      sql`${isSlotMultiple(table.budgetMinutes)} AND ${table.budgetMinutes} >= ${formatLiteral(SLOT)} AND ((${table.mode} = 'day' AND ${table.budgetMinutes} <= ${formatLiteral(DAY)}) OR (${table.mode} = 'week' AND ${table.budgetMinutes} <= ${formatLiteral(WEEK)}))`,
    ),
    check("activities_days", isBetween(table.days, 1, 7)),
  ],
);

/**
 * Every block's row, deleted ones too. A block's activity is set when it's added and never
 * changes, and the activity's row stays when it's deleted, so the foreign key always holds.
 */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text().$type<BlockId>().primaryKey(),
    activityId: text("activity_id")
      .$type<ActivityId>()
      .notNull()
      .references(() => activities.id),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull(),
    existenceStamp: createStampColumn("existence_stamp"),
    day: integer().$type<DayIndex>().notNull(),
    start: integer().$type<DayMinute>().notNull(),
    length: integer().$type<Length>().notNull(),
    timeStamp: createStampColumn("time_stamp"),
  },
  (table) => [
    ...checkStamps("blocks", {
      existence_stamp: table.existenceStamp,
      time_stamp: table.timeStamp,
    }),
    check("blocks_is_deleted", isBoolean(table.isDeleted)),
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
    dayStartStamp: createStampColumn("day_start_stamp"),
    dayEnd: integer("day_end").$type<Hour>().notNull(),
    dayEndStamp: createStampColumn("day_end_stamp"),
    /** When the example week was loaded (ISO 8601, UTC), null when there is none. */
    exampleLoadedAt: text("example_loaded_at"),
    exampleLoadedAtStamp: createStampColumn("example_loaded_at_stamp"),
  },
  (table) => [
    ...checkStamps("settings", {
      day_start_stamp: table.dayStartStamp,
      day_end_stamp: table.dayEndStamp,
      example_loaded_at_stamp: table.exampleLoadedAtStamp,
    }),
    check("settings_day_start", isBetween(table.dayStart, 0, 12)),
    check("settings_day_end", isBetween(table.dayEnd, 13, 24)),
  ],
);

/**
 * A single row (id 1) with this browser's node: its id in the stamps it issues, and its clock, the
 * latest stamp it has issued or merged (see Stamps and the clock in docs/spec/merge.md). Made by
 * the first save after the database opens without one.
 */
export const node = sqliteTable(
  "node",
  {
    id: integer().primaryKey(),
    nodeId: text("node_id").$type<NodeId>().notNull(),
    clock: createStampColumn("clock"),
  },
  (table) => [
    check(
      "node_node_id",
      sql`length(${table.nodeId}) BETWEEN 1 AND 40 AND ${isAlphanumeric(table.nodeId)}`,
    ),
    ...checkStamps("node", { clock: table.clock }),
  ],
);
