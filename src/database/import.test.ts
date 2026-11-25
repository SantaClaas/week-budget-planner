import { readFileSync, readdirSync } from "node:fs";

import { connect } from "@tursodatabase/database";
import { getTableName } from "drizzle-orm";
import * as driverCore from "drizzle-orm/tursodatabase/driver-core";
import { migrate } from "drizzle-orm/tursodatabase/wasm-migrator";
import { describe, expect, it } from "vitest";

import { LOWEST, parse as parseStamp, parseNodeId, type NodeId } from "../merge/stamp.ts";
import { createExampleWeek } from "../plan/example.ts";
import { sanitizeActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { createPredictableIds } from "../plan/test-data.ts";
import { sanitizeDayStart } from "../plan/time.ts";
import { createLocalQueryService, type TursoConnection } from "./connection.ts";
import { createDatabase, type Database } from "./drizzle.ts";
import { IMPORTED_TABLES, rebuild } from "./import.ts";
import { MIGRATION_NAMES, runMigrations } from "./migration.ts";
import { loadNode, loadPlan, loadRows, saveAction } from "./plan-repository.ts";
import { activities as activitiesTable } from "./schema.ts";

const NOW = Temporal.Instant.from("2026-10-15T08:00:00Z");

function requireValue<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`The test has no ${what}.`);

  return value;
}

const SOURCE_NODE: NodeId = requireValue(parseNodeId("sourceNode"), "source node id");
const TARGET_NODE: NodeId = requireValue(parseNodeId("targetNode"), "target node id");
const LATER_CLOCK = requireValue(parseStamp("1900000000000-000004-elsewhere"), "later clock");

const createExample = (): Plan => createExampleWeek(NOW, createPredictableIds());

const wrapDatabase = (connection: TursoConnection): Database =>
  createDatabase(createLocalQueryService(() => Promise.resolve(connection)));

/** A migrated in-memory database with a Drizzle wrapper. */
async function openMigrated(): Promise<{ connection: TursoConnection; database: Database }> {
  const connection = await connect(":memory:");
  expect(await runMigrations(connection)).toBe("migrated");
  return { connection, database: wrapDatabase(connection) };
}

/** The first migration's SQL, before stamps: what databases saved by the first release hold. */
function readFirstMigration(): [string, string] {
  const [first = ""] = readdirSync(new URL("../../drizzle/", import.meta.url)).toSorted();
  return [
    first,
    readFileSync(new URL(`../../drizzle/${first}/migration.sql`, import.meta.url), "utf8"),
  ];
}

/**
 * A crafted database that lists every current migration as applied, while its `activities` table
 * lacks every `CHECK` constraint and `STRICT` (simulating the threat model's crafted file).
 */
async function createDatabaseWithoutActivityConstraints(): Promise<TursoConnection> {
  const connection = await connect(":memory:");
  await connection.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)",
  );
  for (const name of MIGRATION_NAMES) {
    // oxlint-disable-next-line no-await-in-loop -- inserting migration rows in order in a test helper.
    await connection.exec(
      `INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, '${name}')`,
    );
  }

  await connection.exec(`CREATE TABLE activities (
    id text, name text, name_stamp text, hue integer, hue_stamp text, shape text, shape_stamp text,
    mode text, budget_minutes integer, days integer, budget_stamp text, order_key text,
    order_stamp text, is_deleted integer, existence_stamp text, created_at text
  )`);
  await connection.exec(`CREATE TABLE blocks (
    id text, activity_id text, is_deleted integer, existence_stamp text, day integer, start integer,
    length integer, time_stamp text
  )`);
  await connection.exec(`CREATE TABLE settings (
    id integer, day_start integer, day_start_stamp text, day_end integer, day_end_stamp text,
    example_loaded_at text, example_loaded_at_stamp text
  )`);
  await connection.exec("CREATE TABLE node (id integer, node_id text, clock text)");
  await connection.exec(`INSERT INTO activities VALUES (
    'work', 'Work', '${LOWEST}', 78, '${LOWEST}', 'square', '${LOWEST}', 'week', 720, 5,
    '${LOWEST}', '11', '${LOWEST}', 0, '${LOWEST}', '2026-10-01T00:00:00Z'
  )`);
  await connection.exec(
    `INSERT INTO blocks VALUES ('b1', 'work', 0, '${LOWEST}', 0, 600, 90, '${LOWEST}')`,
  );
  await connection.exec(
    `INSERT INTO settings VALUES (1, 7, '${LOWEST}', 22, '${LOWEST}', NULL, '${LOWEST}')`,
  );
  return connection;
}

describe("rebuilding an imported database", () => {
  it("copies every table the migrations create", async () => {
    const { connection } = await openMigrated();
    const statement = await connection.prepare(
      "SELECT name FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite%' AND name <> '__drizzle_migrations' ORDER BY name",
    );
    const copiedNames = IMPORTED_TABLES.map(({ table }) => getTableName(table)).toSorted();
    expect(await statement.raw(true).all()).toEqual(copiedNames.map((name) => [name]));
  });

  it("keeps the plan, stamps, deletion markers, created_at and renews the node", async () => {
    const source = await openMigrated();
    const example = await saveAction(source.database, createExample, NOW, () => SOURCE_NODE);
    const gym = requireValue(
      example.activities.find((activity) => activity.name === "Gym"),
      "the gym",
    ).id;
    await saveAction(
      source.database,
      (plan) => ({
        ...plan,
        activities: plan.activities.filter((activity) => activity.id !== gym),
        blocks: plan.blocks.filter((block) => block.activityId !== gym),
      }),
      NOW.add({ seconds: 1 }),
      () => SOURCE_NODE,
    );
    const beforeRows = await loadRows(source.database);
    const beforeCreatedAt = await source.database
      .select({ id: activitiesTable.id, createdAt: activitiesTable.createdAt })
      .from(activitiesTable);

    const targetConnection = await connect(":memory:");
    expect(await rebuild(source.connection, targetConnection, LATER_CLOCK, TARGET_NODE)).toBe(
      "rebuilt",
    );
    const targetDatabase = wrapDatabase(targetConnection);
    const afterRows = await loadRows(targetDatabase);
    expect(afterRows.rows).toEqual(beforeRows.rows);
    expect(afterRows.isStored).toBe(true);
    expect(afterRows.rows.activities.get(gym)?.existence.value.isDeleted).toBe(true);
    expect(afterRows.node).toEqual({ nodeId: TARGET_NODE, clock: LATER_CLOCK });
    const afterCreatedAt = await targetDatabase
      .select({ id: activitiesTable.id, createdAt: activitiesTable.createdAt })
      .from(activitiesTable);
    expect(afterCreatedAt).toEqual(beforeCreatedAt);
  });

  it("keeps the imported file's clock when it is later than this browser's", async () => {
    const source = await openMigrated();
    await saveAction(source.database, createExample, NOW, () => SOURCE_NODE);
    const sourceClock = requireValue(await loadNode(source.database), "source node").clock;

    const targetConnection = await connect(":memory:");
    expect(await rebuild(source.connection, targetConnection, LOWEST, TARGET_NODE)).toBe("rebuilt");
    expect(await loadNode(wrapDatabase(targetConnection))).toEqual({
      nodeId: TARGET_NODE,
      clock: sourceClock,
    });
  });

  it("migrates a database saved before stamps and rebuilds it cleanly", async () => {
    const sourceConnection = await connect(":memory:");
    const [name, sql] = readFirstMigration();
    // oxlint-disable-next-line typescript/consistent-type-assertions -- construct() exists at runtime, but Drizzle's types leave it out (as in migration.ts).
    const driver = driverCore as unknown as {
      construct(client: unknown): Parameters<typeof migrate>[0];
    };
    expect(
      await migrate(driver.construct(sourceConnection), { migrations: { [name]: sql } }),
    ).toBeFalsy();
    await sourceConnection.exec(`INSERT INTO activities VALUES
      ('work', 'Work', 78, 'square', 'week', 720, 5, 1, '2026-10-01T00:00:00Z'),
      ('gym', 'Gym', 152, 'arch', 'day', 90, 3, 0, '2026-10-01T00:00:00Z')`);
    await sourceConnection.exec("INSERT INTO blocks VALUES ('b1', 'work', 0, 600, 90)");
    await sourceConnection.exec("INSERT INTO settings VALUES (1, 6, 23, NULL)");

    const targetConnection = await connect(":memory:");
    expect(await rebuild(sourceConnection, targetConnection, undefined, TARGET_NODE)).toBe(
      "rebuilt",
    );
    const targetDatabase = wrapDatabase(targetConnection);
    const { plan, isStored } = await loadPlan(targetDatabase, createPredictableIds());
    expect(isStored).toBe(true);
    expect(plan.activities.map((activity) => activity.id)).toEqual(["gym", "work"]);
    expect(plan.blocks).toHaveLength(1);
    expect(await loadNode(targetDatabase)).toBeUndefined();
    const work = requireValue(sanitizeActivityId("work"), "work id");
    expect((await loadRows(targetDatabase)).rows.activities.get(work)?.name.stamp).toBe(LOWEST);
  });

  it("drops triggers from an imported database so later saves stay safe", async () => {
    const source = await openMigrated();
    await saveAction(source.database, createExample, NOW, () => SOURCE_NODE);
    await source.connection.exec(
      "CREATE TRIGGER wipe_blocks AFTER INSERT ON activities BEGIN DELETE FROM blocks; END",
    );
    await source.connection.exec("CREATE TABLE extra_table (body TEXT)");
    await source.connection.exec("CREATE VIEW extra_view AS SELECT id FROM activities");

    const targetConnection = await connect(":memory:");
    expect(await rebuild(source.connection, targetConnection, undefined, TARGET_NODE)).toBe(
      "rebuilt",
    );
    const triggers = await (
      await targetConnection.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    )
      .raw(true)
      .all();
    expect(triggers).toEqual([]);
    const views = await (
      await targetConnection.prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
    )
      .raw(true)
      .all();
    expect(views).toEqual([]);
    const extras = await (
      await targetConnection.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'extra_table'",
      )
    )
      .raw(true)
      .all();
    expect(extras).toEqual([]);

    const targetDatabase = wrapDatabase(targetConnection);
    const before = (await loadPlan(targetDatabase, createPredictableIds())).plan;
    await saveAction(
      targetDatabase,
      (plan) => ({
        ...plan,
        activities: [
          ...plan.activities,
          {
            ...requireValue(plan.activities[0], "first activity"),
            id: requireValue(sanitizeActivityId("newActivity"), "activity id"),
            name: requireValue(plan.activities[0], "first activity").name,
          },
        ],
      }),
      NOW.add({ seconds: 5 }),
      () => TARGET_NODE,
    );
    const after = (await loadPlan(targetDatabase, createPredictableIds())).plan;
    expect(after.blocks).toHaveLength(before.blocks.length);
  });

  it("restores STRICT and CHECK constraints when an imported file's table lacks them", async () => {
    const sourceConnection = await createDatabaseWithoutActivityConstraints();
    const targetConnection = await connect(":memory:");
    expect(await rebuild(sourceConnection, targetConnection, undefined, TARGET_NODE)).toBe(
      "rebuilt",
    );
    const strictTables = await (
      await targetConnection.prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name = 'activities'",
      )
    ).all();
    expect(strictTables).toEqual([{ name: "activities", strict: 1 }]);
    await expect(targetConnection.exec("UPDATE activities SET hue = 1")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
  });

  it("refuses invalid rows smuggled into a table without CHECK constraints", async () => {
    const badStatements = [
      "UPDATE activities SET hue = 1",
      "UPDATE activities SET is_deleted = 2",
      "UPDATE activities SET name_stamp = 'yesterday'",
      "UPDATE activities SET name = '   '",
      "UPDATE blocks SET activity_id = 'missing'",
      "UPDATE settings SET example_loaded_at = 'yesterday'",
      "INSERT INTO settings VALUES (2, 7, '0000000000000-000000-', 22, '0000000000000-000000-', NULL, '0000000000000-000000-')",
      "UPDATE settings SET id = 2",
      "INSERT INTO node VALUES (1, 'bad-node-id', '0000000000000-000000-')",
    ];
    for (const statement of badStatements) {
      // oxlint-disable-next-line no-await-in-loop -- each bad mutation gets its own fresh source and target database.
      const sourceConnection = await createDatabaseWithoutActivityConstraints();
      // oxlint-disable-next-line no-await-in-loop -- applying the mutation before testing rebuild.
      await sourceConnection.exec(statement);
      // oxlint-disable-next-line no-await-in-loop -- creating a fresh target for this case.
      const targetConnection = await connect(":memory:");
      // oxlint-disable-next-line no-await-in-loop -- checking rebuild rejects this crafted database.
      expect(await rebuild(sourceConnection, targetConnection, undefined, TARGET_NODE)).toBe(
        "invalid-file",
      );
    }
  });

  it("refuses an unrelated SQLite database that has no applied migrations", async () => {
    const sourceConnection = await connect(":memory:");
    await sourceConnection.exec("CREATE TABLE notes (body TEXT)");
    await sourceConnection.exec("INSERT INTO notes VALUES ('hello')");
    const targetConnection = await connect(":memory:");
    expect(await rebuild(sourceConnection, targetConnection, undefined, TARGET_NODE)).toBe(
      "invalid-file",
    );
  });

  it("refuses a database from a newer version of the app", async () => {
    const source = await openMigrated();
    await source.connection.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, '29991231000000_future')",
    );
    const targetConnection = await connect(":memory:");
    expect(await rebuild(source.connection, targetConnection, undefined, TARGET_NODE)).toBe(
      "newer-version",
    );
  });

  it("keeps saving on the rebuilt database", async () => {
    const source = await openMigrated();
    await saveAction(source.database, createExample, NOW, () => SOURCE_NODE);
    const targetConnection = await connect(":memory:");
    expect(await rebuild(source.connection, targetConnection, LATER_CLOCK, TARGET_NODE)).toBe(
      "rebuilt",
    );
    const targetDatabase = wrapDatabase(targetConnection);
    await saveAction(
      targetDatabase,
      (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }),
      NOW.add({ seconds: 10 }),
      () => TARGET_NODE,
    );
    expect((await loadPlan(targetDatabase, createPredictableIds())).plan.dayStart).toBe(6);
  });
});
