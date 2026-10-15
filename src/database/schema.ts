import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { THEMES } from "../theme";

/** Activities in list order (`position`). Times and budgets are integer minutes. */
export const activities = sqliteTable("activities", {
  id: text().primaryKey(),
  name: text().notNull(),
  hue: integer().notNull(),
  shape: text().notNull(),
  mode: text({ enum: ["week", "day"] }).notNull(),
  budgetMinutes: integer("budget_minutes").notNull(),
  days: integer().notNull(),
  position: integer().notNull(),
  createdAt: text("created_at").notNull(),
});

/** Blocks on the week. Deleting an activity deletes its blocks in the same transaction. */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text().primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id),
    day: integer().notNull(),
    start: integer().notNull(),
    length: integer().notNull(),
  },
  (table) => [index("blocks_activity_id").on(table.activityId)],
);

/** A single row (id 1) with the week's settings and this device's theme choice. */
export const settings = sqliteTable("settings", {
  id: integer().primaryKey(),
  dayStart: integer("day_start").notNull(),
  dayEnd: integer("day_end").notNull(),
  example: integer({ mode: "boolean" }).notNull(),
  theme: text({ enum: THEMES }).notNull().default("system"),
});
