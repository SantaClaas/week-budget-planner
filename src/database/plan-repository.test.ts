import { connect } from "@tursodatabase/database";
import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example";
import { sanitizeActivityId, sanitizeBlockId } from "../plan/id";
import {
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength,
} from "../plan/time";
import type { Plan } from "../plan/types";
import { createLocalQueryService, type TursoConnection } from "./connection";
import { createDatabase, type Database } from "./drizzle";
import { MIGRATION_NAMES, NewerDatabaseError, runMigrations } from "./migrations";
import { loadPlan, buildPlanStatements, savePlan } from "./plan-repository";
import { blocks as blocksTable } from "./schema";

/** A migrated in-memory database behind the same proxy path the app uses. */
async function openTestDatabase(): Promise<{ database: Database; connection: TursoConnection }> {
  const connection = (await connect(":memory:")) as unknown as TursoConnection;
  await runMigrations(connection);
  return { database: createDatabase(createLocalQueryService(async () => connection)), connection };
}

const example = (): Plan => createExampleWeek(Temporal.Instant.from("2026-10-15T08:00:00Z"));

describe("migrations", () => {
  it("bundles the generated migrations", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThan(0);
    for (const name of MIGRATION_NAMES) expect(name).toMatch(/^\d{14}_/);
  });

  it("can run again on a migrated database", async () => {
    const connection = (await connect(":memory:")) as unknown as TursoConnection;
    await runMigrations(connection);
    await expect(runMigrations(connection)).resolves.toBeUndefined();
  });

  it("refuses a database from a newer version of the app", async () => {
    const connection = (await connect(":memory:")) as unknown as TursoConnection;
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
    const { plan, isStored } = await loadPlan(database);
    expect(isStored).toBe(false);
    expect(plan.activities).toEqual([]);
    expect(plan.dayStart).toBe(7);
  });

  it("round-trips a plan", async () => {
    const { database } = await openTestDatabase();
    await savePlan(database, undefined, example());
    const { plan, isStored } = await loadPlan(database);
    expect(isStored).toBe(true);
    expect(plan).toEqual(example());
  });

  it("writes only what changed", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before);
    const after: Plan = {
      ...before,
      blocks: before.blocks.map((block) =>
        block.id === "block-1" ? { ...block, start: sanitizeDayMinute(660) } : block,
      ),
    };
    expect(buildPlanStatements(database, before, after)).toHaveLength(1);
    expect(buildPlanStatements(database, before, before)).toHaveLength(0);
    await savePlan(database, before, after);
    expect((await loadPlan(database)).plan).toEqual(after);
  });

  it("deletes an activity together with its blocks", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before);
    const after: Plan = {
      ...before,
      activities: before.activities.filter((activity) => activity.id !== "gym"),
      blocks: before.blocks.filter((block) => block.activityId !== "gym"),
    };
    await savePlan(database, before, after);
    const { plan } = await loadPlan(database);
    expect(plan.activities.map((activity) => activity.id)).not.toContain("gym");
    expect(plan.blocks.some((block) => block.activityId === "gym")).toBe(false);
  });

  it("keeps the list order when activities move", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before);
    const after: Plan = { ...before, activities: before.activities.toReversed() };
    await savePlan(database, before, after);
    expect((await loadPlan(database)).plan.activities.map((activity) => activity.id)).toEqual(
      after.activities.map((activity) => activity.id),
    );
  });

  it("rolls the whole action back when one statement fails", async () => {
    const { database } = await openTestDatabase();
    const before = example();
    await savePlan(database, undefined, before);
    const after: Plan = { ...before, dayStart: sanitizeDayStart(6) };
    const [settingsUpdate] = buildPlanStatements(database, before, after);
    // A duplicate primary key makes the second statement fail after the first one ran.
    const duplicate = database.insert(blocksTable).values({
      id: sanitizeBlockId("block-1")!,
      activityId: sanitizeActivityId("stats")!,
      day: sanitizeDayIndex(0),
      start: sanitizeDayMinute(0),
      length: sanitizeLength(15),
    });
    await expect(database.batch([settingsUpdate!, duplicate])).rejects.toThrow(
      /UNIQUE|constraint/i,
    );
    expect((await loadPlan(database)).plan.dayStart).toBe(7);
  });

  it("refuses values that break the rules, even past the types", async () => {
    const { database, connection } = await openTestDatabase();
    await savePlan(database, undefined, example());
    const insert = (values: string) =>
      connection.exec(
        `INSERT INTO blocks (id, activity_id, day, start, length) VALUES (${values})`,
      );
    await expect(insert("'b1', 'stats', 7, 600, 60")).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert("'b2', 'stats', 0, 607, 60")).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert("'b3', 'stats', 0, 600, 1455")).rejects.toThrow(/CHECK constraint failed/);
    await expect(insert("'', 'stats', 0, 600, 60")).rejects.toThrow(/CHECK constraint failed/);
    await expect(connection.exec("UPDATE activities SET hue = 1")).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await expect(
      connection.exec("UPDATE activities SET mode = 'day', budget_minutes = 1500"),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(connection.exec("UPDATE settings SET day_end = 12")).rejects.toThrow(
      /CHECK constraint failed/,
    );
    await insert("'b4', 'stats', 6, 1425, 1440");
  });
});
