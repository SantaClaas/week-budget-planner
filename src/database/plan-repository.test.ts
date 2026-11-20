import { readFileSync, readdirSync } from "node:fs";

import { connect } from "@tursodatabase/database";
import * as driverCore from "drizzle-orm/tursodatabase/driver-core";
import { migrate } from "drizzle-orm/tursodatabase/wasm-migrator";
import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import { sanitizeActivityId } from "../plan/id.ts";
import {
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength,
} from "../plan/time.ts";
import type { Plan } from "../plan/index.ts";
import { createLocalQueryService, type TursoConnection } from "./connection.ts";
import { createDatabase, type Database } from "./drizzle.ts";
import { MIGRATION_NAMES, runMigrations } from "./migration.ts";
import { LOWEST, parse as parseStamp, parseNodeId, type NodeId } from "../merge/stamp.ts";
import {
  buildChangeStatements,
  loadNode,
  loadPlan,
  loadRows,
  renewNode,
  saveAction,
} from "./plan-repository.ts";
import { activities as activitiesTable, blocks as blocksTable } from "./schema.ts";
import { createPredictableIds } from "../plan/test-data.ts";

const NOW = Temporal.Instant.from("2026-10-15T08:00:00Z");

/** A migrated in-memory database behind the same proxy path the app uses. */
async function openTestDatabase(): Promise<{ database: Database; connection: TursoConnection }> {
  const connection = await connect(":memory:");
  expect(await runMigrations(connection)).toBe("migrated");
  return {
    database: createDatabase(createLocalQueryService(() => Promise.resolve(connection))),
    connection,
  };
}

function requireValue<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`The test has no ${what}.`);

  return value;
}

const createExample = (): Plan => createExampleWeek(NOW, createPredictableIds());

/** The plan as the rows show it: its blocks in order of their ids. */
const sortBlocks = (plan: Plan): Plan => ({
  ...plan,
  blocks: plan.blocks.toSorted((first, second) => (first.id < second.id ? -1 : 1)),
});

const NODE_ID: NodeId = requireValue(parseNodeId("testNode"), "node id");
const createNodeId = (): NodeId => NODE_ID;

/** Saves the action `update` at `now` as the store does, for a database with no other tabs. */
const save = (database: Database, update: (before: Plan) => Plan, now = NOW): Promise<Plan> =>
  saveAction(database, update, now, createNodeId);

/** The first migration's SQL, before stamps: what databases saved by the first release hold. */
const readFirstMigration = (): [string, string] => {
  const [first = ""] = readdirSync(new URL("../../drizzle/", import.meta.url)).toSorted();
  return [
    first,
    readFileSync(new URL(`../../drizzle/${first}/migration.sql`, import.meta.url), "utf8"),
  ];
};

describe("migrations", () => {
  it("bundles the generated migrations", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThan(0);
    for (const name of MIGRATION_NAMES) expect(name).toMatch(/^\d{14}_/u);
  });

  it("logs every migration in docs/spec/formats.md", () => {
    // Someone importing an old export finds there what changed and whether it still imports.
    const log = readFileSync(new URL("../../docs/spec/formats.md", import.meta.url), "utf8");
    const missing = MIGRATION_NAMES.filter((name) => !log.includes(`### \`${name}\``));
    expect(missing).toEqual([]);
  });

  it("makes every table STRICT, which drizzle-kit leaves out", async () => {
    // A migration drizzle-kit generates later, for example one that rebuilds a table to change it,
    // comes without STRICT. Add it to that migration's SQL by hand, as in the first one.
    const connection = await connect(":memory:");
    expect(await runMigrations(connection)).toBe("migrated");
    const statement = await connection.prepare(
      "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite%' AND name <> '__drizzle_migrations' ORDER BY name",
    );
    const tables: unknown[] = await statement.all();
    expect(tables).toEqual([
      { name: "activities", strict: 1 },
      { name: "blocks", strict: 1 },
      { name: "node", strict: 1 },
      { name: "settings", strict: 1 },
    ]);
  });

  it("can run again on a migrated database", async () => {
    const connection = await connect(":memory:");
    expect(await runMigrations(connection)).toBe("migrated");
    expect(await runMigrations(connection)).toBe("migrated");
  });

  it("refuses a database from a newer version of the app", async () => {
    const connection = await connect(":memory:");
    expect(await runMigrations(connection)).toBe("migrated");
    await connection.exec(
      `INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, '29991231000000_future')`,
    );
    expect(await runMigrations(connection)).toBe("newer-version");
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
    const example = createExample();
    expect(await save(database, () => example)).toEqual(sortBlocks(example));
    const { plan, isStored } = await loadPlan(database, createPredictableIds());
    expect(isStored).toBe(true);
    expect(plan).toEqual(sortBlocks(example));
  });

  it("creates every row of one action at the action's time", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    const rows = await database
      .select({ createdAt: activitiesTable.createdAt })
      .from(activitiesTable);
    expect(new Set(rows.values().map((row) => row.createdAt))).toEqual(new Set([NOW.toString()]));
  });

  it("makes the node on the first save, and moves its clock on with each", async () => {
    const { database } = await openTestDatabase();
    expect((await loadRows(database)).node).toBeUndefined();
    await save(database, createExample);
    const first = requireValue((await loadRows(database)).node, "node");
    expect(first.nodeId).toBe("testNode");
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }), NOW);
    const second = requireValue((await loadRows(database)).node, "node");
    expect(second.clock > first.clock).toBe(true);
    expect(second.clock.endsWith("-testNode")).toBe(true);
  });

  it("stamps only what the action changed", async () => {
    const { database } = await openTestDatabase();
    const example = createExample();
    await save(database, () => example);
    const firstStamp = requireValue((await loadRows(database)).node, "node").clock;
    const later = NOW.add({ seconds: 1 });
    await save(
      database,
      (plan) => {
        const [first, ...rest] = plan.blocks;
        return {
          ...plan,
          blocks: [
            { ...requireValue(first, "first block"), start: sanitizeDayMinute(660) },
            ...rest,
          ],
        };
      },
      later,
    );
    const { rows } = await loadRows(database);
    const movedId = requireValue(sortBlocks(example).blocks[0], "first block").id;
    const moved = requireValue(rows.blocks.get(movedId), "moved block");
    expect(moved.time.stamp > firstStamp).toBe(true);
    expect(moved.existence.stamp).toBe(firstStamp);
    const others = rows.blocks.values().filter((row) => row.id !== movedId);
    expect(others.every((row) => row.time.stamp === firstStamp)).toBe(true);
  });

  it("keeps a deleted activity and its blocks as deletion markers", async () => {
    const { database } = await openTestDatabase();
    const example = createExample();
    await save(database, () => example);
    const gym = requireValue(
      example.activities.find((activity) => activity.name === "Gym"),
      "the gym",
    ).id;
    await save(database, (plan) => ({
      ...plan,
      activities: plan.activities.filter((activity) => activity.id !== gym),
      blocks: plan.blocks.filter((block) => block.activityId !== gym),
    }));
    const { plan } = await loadPlan(database, createPredictableIds());
    expect(plan.activities.map((activity) => activity.id)).not.toContain(gym);
    expect(plan.blocks.some((block) => block.activityId === gym)).toBe(false);
    const { rows } = await loadRows(database);
    expect(rows.activities.get(gym)?.existence.value.isDeleted).toBe(true);
    const gymBlocks = rows.blocks.values().filter((row) => row.existence.value.activityId === gym);
    expect(gymBlocks.every((row) => row.existence.value.isDeleted)).toBe(true);
  });

  it("keeps the list order when activities move", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    const reversed = await save(database, (plan) => ({
      ...plan,
      activities: plan.activities.toReversed(),
    }));
    expect(
      (await loadPlan(database, createPredictableIds())).plan.activities.map(
        (activity) => activity.id,
      ),
    ).toEqual(reversed.activities.map((activity) => activity.id));
  });

  it("keeps what an earlier save wrote, since each action is applied to the rows as they are", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }));
    const { plan } = await loadPlan(database, createPredictableIds());
    expect(plan.dayStart).toBe(6);
    await save(database, (shown) => ({ ...shown, dayEnd: plan.dayEnd }));
    expect((await loadPlan(database, createPredictableIds())).plan.dayStart).toBe(6);
  });

  it("rolls the whole action back when one statement fails", async () => {
    const { database } = await openTestDatabase();
    const example = await save(database, createExample);
    const { rows } = await loadRows(database);
    const change = {
      version: 1 as const,
      activities: [],
      blocks: [],
      settings: {
        ...rows.settings,
        dayStart: { ...rows.settings.dayStart, value: sanitizeDayStart(6) },
      },
    };
    const [settingsUpdate] = buildChangeStatements(
      database,
      change,
      { nodeId: NODE_ID, clock: LOWEST },
      NOW,
    );
    // A duplicate primary key makes the second statement fail after the first one ran.
    const duplicate = database.insert(blocksTable).values({
      id: requireValue(example.blocks[0], "first block").id,
      activityId: requireValue(example.activities[0], "first activity").id,
      isDeleted: false,
      existenceStamp: LOWEST,
      day: sanitizeDayIndex(0),
      start: sanitizeDayMinute(0),
      length: sanitizeLength(15),
      timeStamp: LOWEST,
    });
    await expect(
      database.batch([requireValue(settingsUpdate, "settings update"), duplicate]),
    ).rejects.toThrow(/UNIQUE|constraint/iu);
    expect((await loadPlan(database, createPredictableIds())).plan.dayStart).toBe(7);
    // The rollback ended the transaction, so the next action starts one of its own and is saved.
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }));
    expect((await loadPlan(database, createPredictableIds())).plan.dayStart).toBe(6);
  });

  it("refuses values that break the rules, even past the types", async () => {
    const { database, connection } = await openTestDatabase();
    const example = await save(database, createExample);
    const activityId = requireValue(example.activities[0], "first activity").id;
    const lowest = "'0000000000000-000000-'";
    const insert = (values: string) =>
      connection.exec(
        `INSERT INTO blocks (id, activity_id, is_deleted, existence_stamp, day, start, length, time_stamp) VALUES (${values})`,
      );
    const insertBlock = (id: string, day: number, start: number, length: number, stamp = lowest) =>
      insert(
        `'${id}', '${activityId}', 0, ${lowest}, ${String(day)}, ${String(start)}, ${String(length)}, ${stamp}`,
      );
    await expect(insertBlock("b1", 7, 600, 60)).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insertBlock("b2", 0, 607, 60)).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insertBlock("b3", 0, 600, 1455)).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insertBlock("", 0, 600, 60)).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insertBlock("b5", 0, 600, 60, "'yesterday'")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await expect(insertBlock("b6", 0, 600, 60, "'1763200000000-000001-no-hyphen'")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await expect(
      insert(`'b7', '${activityId}', 2, ${lowest}, 0, 600, 60, ${lowest}`),
    ).rejects.toThrow(/CHECK constraint failed/u);
    await expect(connection.exec("UPDATE activities SET hue = 1")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await expect(
      connection.exec("UPDATE activities SET mode = 'day', budget_minutes = 1500"),
    ).rejects.toThrow(/CHECK constraint failed/u);
    await Promise.all(
      ["''", "'V0'", "'V-'"].map((key) =>
        expect(connection.exec(`UPDATE activities SET order_key = ${key}`)).rejects.toThrow(
          /CHECK constraint failed/u,
        ),
      ),
    );

    await expect(connection.exec("UPDATE settings SET day_end = 12")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await insertBlock("b8", 6, 1425, 1440, "'1763200000000-000001-Node7'");
  });
});

describe("the migration to stamps", () => {
  it("keeps a plan saved before stamps, with the lowest stamps and its order", async () => {
    const connection = await connect(":memory:");
    const [name, sql] = readFirstMigration();
    // The first migration alone, through Drizzle's migrator, as the first release ran it.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- construct() exists at runtime, but Drizzle's types leave it out (as in migration.ts).
    const driver = driverCore as unknown as {
      construct(client: unknown): Parameters<typeof migrate>[0];
    };
    expect(
      await migrate(driver.construct(connection), { migrations: { [name]: sql } }),
    ).toBeFalsy();
    await connection.exec(`INSERT INTO activities VALUES
      ('work', 'Work', 78, 'square', 'week', 720, 5, 1, '2026-10-01T00:00:00Z'),
      ('gym', 'Gym', 152, 'arch', 'day', 90, 3, 0, '2026-10-01T00:00:00Z'),
      ('read', 'Read', 255, 'circle', 'week', 120, 5, 2, '2026-10-01T00:00:00Z')`);
    await connection.exec(
      `INSERT INTO blocks VALUES ('b1', 'work', 0, 600, 90), ('b2', 'gym', 2, 420, 60)`,
    );
    await connection.exec("INSERT INTO settings VALUES (1, 6, 23, NULL)");

    expect(await runMigrations(connection)).toBe("migrated");
    const database = createDatabase(createLocalQueryService(() => Promise.resolve(connection)));
    const { plan, isStored } = await loadPlan(database, createPredictableIds());
    expect(isStored).toBe(true);
    expect(plan.activities.map((activity) => activity.id)).toEqual(["gym", "work", "read"]);
    expect(plan.activities[1]).toMatchObject({ name: "Work", hue: 78, budgetMinutes: 720 });
    expect(plan.blocks.map((block) => [block.id, block.activityId, block.start])).toEqual([
      ["b1", "work", 600],
      ["b2", "gym", 420],
    ]);
    expect(plan).toMatchObject({ dayStart: 6, dayEnd: 23, exampleLoadedAt: null });
    const { rows, node } = await loadRows(database);
    expect(node).toBeUndefined();
    const work = requireValue(sanitizeActivityId("work"), "activity id");
    expect(rows.activities.get(work)?.name.stamp).toBe(LOWEST);

    // The next save works on the migrated rows.
    await saveAction(
      database,
      (shown) => ({ ...shown, dayStart: sanitizeDayStart(8) }),
      NOW,
      createNodeId,
    );
    expect((await loadPlan(database, createPredictableIds())).plan.dayStart).toBe(8);
  });
});

describe("the node after an import", () => {
  const imported = requireValue(parseNodeId("newNode"), "node id");
  const later = requireValue(parseStamp("1900000000000-000004-elsewhere"), "stamp");

  it("gets a new id, and keeps the file's clock where it's later", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    const fileClock = requireValue(await loadNode(database), "node").clock;
    expect(await renewNode(database, LOWEST, imported)).toEqual({
      nodeId: "newNode",
      clock: fileClock,
    });
    expect(await loadNode(database)).toEqual({ nodeId: "newNode", clock: fileClock });
  });

  it("keeps this browser's clock where it's later", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    expect(await renewNode(database, later, imported)).toEqual({ nodeId: "newNode", clock: later });
  });

  it("takes this browser's clock for a file that has no node yet", async () => {
    const { database } = await openTestDatabase();
    expect(await renewNode(database, later, imported)).toEqual({ nodeId: "newNode", clock: later });
  });

  it("makes no node when neither has a clock, so the first save makes one", async () => {
    const { database } = await openTestDatabase();
    expect(await renewNode(database, undefined, imported)).toBeUndefined();
    expect(await loadNode(database)).toBeUndefined();
  });

  it("stamps the next save with the new id, later than both clocks", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    await renewNode(database, later, imported);
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }));
    const { rows, node } = await loadRows(database);
    expect(rows.settings.dayStart.stamp.endsWith("-newNode")).toBe(true);
    expect(rows.settings.dayStart.stamp > later).toBe(true);
    expect(node?.clock).toBe(rows.settings.dayStart.stamp);
  });
});
