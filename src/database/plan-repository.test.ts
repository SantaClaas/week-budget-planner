import { connect } from "@tursodatabase/database";
import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import { sanitizeActivityId, sanitizeBlockId } from "../plan/id.ts";
import {
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength,
} from "../plan/time.ts";
import type { Plan } from "../plan/types.ts";
import { createLocalQueryService, type TursoConnection } from "./connection.ts";
import { createDatabase, type Database } from "./drizzle.ts";
import { MIGRATION_NAMES, NewerDatabaseError, runMigrations } from "./migrations.ts";
import { loadPlan, buildPlanStatements, savePlan } from "./plan-repository.ts";
import { activities as activitiesTable, blocks as blocksTable } from "./schema.ts";
import { createPredictableIds } from "../plan/test-data.ts";

const NOW = Temporal.Instant.from("2026-10-15T08:00:00Z");

/** A migrated in-memory database behind the same proxy path the app uses. */
async function openTestDatabase(): Promise<{ database: Database; connection: TursoConnection }> {
  const connection = await connect(":memory:");
  await runMigrations(connection);
  return {
    database: createDatabase(createLocalQueryService(() => Promise.resolve(connection))),
    connection,
  };
}

function required<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`The test has no ${what}.`);
  return value;
}

const example = (): Plan => createExampleWeek(NOW, createPredictableIds());

describe("migrations", () => {
  it("bundles the generated migrations", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThan(0);
    for (const name of MIGRATION_NAMES) expect(name).toMatch(/^\d{14}_/u);
  });

  it("makes every table STRICT, which drizzle-kit leaves out", async () => {
    // A migration drizzle-kit generates later, for example one that rebuilds a table to change it,
    // comes without STRICT. Add it to that migration's SQL by hand, as in the first one.
    const connection = await connect(":memory:");
    await runMigrations(connection);
    const statement = await connection.prepare(
      "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite%' AND name <> '__drizzle_migrations' ORDER BY name",
    );
    const tables: unknown[] = await statement.all();
    expect(tables).toEqual([
      { name: "activities", strict: 1 },
      { name: "blocks", strict: 1 },
      { name: "settings", strict: 1 },
    ]);
  });

  it("can run again on a migrated database", async () => {
    const connection = await connect(":memory:");
    await runMigrations(connection);
    await expect(runMigrations(connection)).resolves.toBeUndefined();
  });

  it("refuses a database from a newer version of the app", async () => {
    const connection = await connect(":memory:");
    await runMigrations(connection);
    await connection.exec(
      `INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, '29991231000000_future')`,
    );
    await expect(runMigrations(connection)).rejects.toThrow(NewerDatabaseError);
  });
});

describe("plan repository", () => {
  it("reports a fresh database as not stored", async () => {
    const { database } = await openTestDatabase();
    const { plan, isStored } = await loadPlan(database, createPredictableIds());
    expect(isStored).toBe(false);
    expect(plan.activities).toEqual([]);
    expect(plan.dayStart).toBe(7);
  });

  it("round-trips a plan", async () => {
    const { database } = await openTestDatabase();
    await savePlan(database, undefined, example(), NOW);
    const { plan, isStored } = await loadPlan(database, createPredictableIds());
    expect(isStored).toBe(true);
    expect(plan).toEqual(example());
  });

  it("creates every row of one action at the action's time", async () => {
    const { database } = await openTestDatabase();
    await savePlan(database, undefined, example(), NOW);
    const rows = await database
      .select({ createdAt: activitiesTable.createdAt })
      .from(activitiesTable);
    expect(new Set(rows.map((row) => row.createdAt))).toEqual(new Set([NOW.toString()]));
  });

  it("writes only what changed", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before, NOW);
    const [first, ...rest] = before.blocks;
    const moved = { ...required(first, "first block"), start: sanitizeDayMinute(660) };
    const after: Plan = { ...before, blocks: [moved, ...rest] };
    expect(buildPlanStatements(database, before, after, NOW)).toHaveLength(1);
    expect(buildPlanStatements(database, before, before, NOW)).toHaveLength(0);
    await savePlan(database, before, after, NOW);
    expect((await loadPlan(database, createPredictableIds())).plan).toEqual(after);
  });

  it("deletes an activity together with its blocks", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before, NOW);
    const after: Plan = {
      ...before,
      activities: before.activities.filter((activity) => activity.id !== "gym"),
      blocks: before.blocks.filter((block) => block.activityId !== "gym"),
    };
    await savePlan(database, before, after, NOW);
    const { plan } = await loadPlan(database, createPredictableIds());
    expect(plan.activities.map((activity) => activity.id)).not.toContain("gym");
    expect(plan.blocks.some((block) => block.activityId === "gym")).toBe(false);
  });

  it("keeps the list order when activities move", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before, NOW);
    const after: Plan = { ...before, activities: before.activities.toReversed() };
    await savePlan(database, before, after, NOW);
    expect(
      (await loadPlan(database, createPredictableIds())).plan.activities.map(
        (activity) => activity.id,
      ),
    ).toEqual(after.activities.map((activity) => activity.id));
  });

  it("rolls the whole action back when one statement fails", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before, NOW);
    const after: Plan = { ...before, dayStart: sanitizeDayStart(6) };
    const [settingsUpdate] = buildPlanStatements(database, before, after, NOW);
    // A duplicate primary key makes the second statement fail after the first one ran.
    const duplicate = database.insert(blocksTable).values({
      id: required(sanitizeBlockId("block-1"), "block id"),
      activityId: required(sanitizeActivityId("stats"), "activity id"),
      day: sanitizeDayIndex(0),
      start: sanitizeDayMinute(0),
      length: sanitizeLength(15),
    });
    await expect(
      database.batch([required(settingsUpdate, "settings update"), duplicate]),
    ).rejects.toThrow(/UNIQUE|constraint/iu);
    expect((await loadPlan(database, createPredictableIds())).plan.dayStart).toBe(7);
  });

  it("refuses values that break the rules, even past the types", async () => {
    const { database, connection } = await openTestDatabase();
    await savePlan(database, undefined, example(), NOW);
    const insert = (values: string) =>
      connection.exec(
        `INSERT INTO blocks (id, activity_id, day, start, length) VALUES (${values})`,
      );
    await expect(insert("'b1', 'stats', 7, 600, 60")).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insert("'b2', 'stats', 0, 607, 60")).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insert("'b3', 'stats', 0, 600, 1455")).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insert("'', 'stats', 0, 600, 60")).rejects.toThrow(/CHECK constraint failed/u);
    await expect(connection.exec("UPDATE activities SET hue = 1")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await expect(
      connection.exec("UPDATE activities SET mode = 'day', budget_minutes = 1500"),
    ).rejects.toThrow(/CHECK constraint failed/u);
    await expect(connection.exec("UPDATE settings SET day_end = 12")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await insert("'b4', 'stats', 6, 1425, 1440");
  });
});
