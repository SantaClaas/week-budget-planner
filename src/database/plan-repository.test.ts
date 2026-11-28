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
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createLocalQueryService, type TursoConnection } from "./connection.ts";
import { createDatabase, type Database } from "./drizzle.ts";
import { MIGRATION_NAMES, runMigrations } from "./migration.ts";
import { LOWEST, parse as parseStamp, parseNodeId, type NodeId } from "../merge/stamp.ts";
import { parseDeviceKey, parseDeviceName } from "../device/index.ts";
import { convertPlan, takeSnapshot } from "../merge/index.ts";
import type { DeviceRow } from "../merge/row.ts";
import { createDevice, createStamp } from "../merge/test-data.ts";
import {
  NO_CHANGE,
  createEmptyOrigins,
  parseChangeNumber,
  type ChangeNumber,
  type Origin,
} from "../sync/origin.ts";
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

function createChangeNumber(value: number): ChangeNumber {
  const number = parseChangeNumber(value);
  if (number === "out-of-range")
    throw new Error(`The test has an invalid counter: ${String(value)}.`);

  return number;
}

const NODE_ID: NodeId = requireValue(parseNodeId("testNode"), "node id");
const createNodeId = (): NodeId => NODE_ID;

/** Saves the action `update` at `now` as the store does, for a database with no other tabs. */
const save = (database: Database, update: (before: Plan) => Plan, now = NOW): Promise<Plan> =>
  saveAction(database, update, now, createNodeId);

/**
 * The first migrations' SQL, by name: what databases saved by the releases before them hold.
 *
 * @param count - How many, from the first.
 */
function readMigrations(count: number): Record<string, string> {
  const names = readdirSync(new URL("../../drizzle/", import.meta.url))
    .toSorted()
    .slice(0, count);
  return Object.fromEntries(
    names
      .values()
      .map((name) => [
        name,
        readFileSync(new URL(`../../drizzle/${name}/migration.sql`, import.meta.url), "utf8"),
      ]),
  );
}

/**
 * A database with only the first migrations applied, through Drizzle's migrator, as the releases
 * before the others ran them.
 */
async function openOlderDatabase(count: number): Promise<TursoConnection> {
  const connection = await connect(":memory:");
  // oxlint-disable-next-line typescript/consistent-type-assertions -- construct() exists at runtime, but Drizzle's types leave it out (as in migration.ts).
  const driver = driverCore as unknown as {
    construct(client: unknown): Parameters<typeof migrate>[0];
  };
  expect(
    await migrate(driver.construct(connection), { migrations: readMigrations(count) }),
  ).toBeFalsy();
  return connection;
}

describe("migrations", () => {
  it("bundles the generated migrations", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThan(0);
    for (const name of MIGRATION_NAMES) expect(name).toMatch(/^\d{14}_/u);
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
      { name: "devices", strict: 1 },
      { name: "node", strict: 1 },
      { name: "progress", strict: 1 },
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

  it("numbers each save with the counter, and notes it on the rows it wrote as this device's", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    const first = await loadRows(database);
    expect(first.node?.counter).toBe(1);
    expect(first.origins.settings).toEqual({ changedAt: 1, changedBy: null });
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }));
    const second = await loadRows(database);
    expect(second.node?.counter).toBe(2);
    expect(second.origins.settings).toEqual({ changedAt: 2, changedBy: null });
    // The activities weren't touched, so they keep the first save's number.
    expect(new Set(second.origins.activities.values().map((origin) => origin.changedAt))).toEqual(
      new Set([1]),
    );
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
      devices: [],
    };
    const [settingsUpdate] = buildChangeStatements(
      database,
      change,
      createEmptyOrigins(),
      { nodeId: NODE_ID, clock: LOWEST, counter: NO_CHANGE },
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
      changedAt: NO_CHANGE,
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
        `INSERT INTO blocks (id, activity_id, is_deleted, existence_stamp, day, start, length, time_stamp, changed_at) VALUES (${values}, 1)`,
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
    await expect(connection.exec("UPDATE activities SET changed_at = -1")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await expect(connection.exec("UPDATE activities SET changed_by = 'phone'")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await expect(connection.exec("UPDATE node SET counter = -1")).rejects.toThrow(
      /CHECK constraint failed/u,
    );
    await insertBlock("b8", 6, 1425, 1440, "'1763200000000-000001-Node7'");
  });
});

describe("the device list's table", () => {
  const key = "a".repeat(64);
  const insertDevice = (connection: TursoConnection, values: Record<string, string>) => {
    const row = {
      id: `'${key}'`,
      relay: "'https://relay.example/'",
      identity_stamp: "'0000000000000-000000-'",
      name: "'Firefox on Linux'",
      name_stamp: "'0000000000000-000000-'",
      status: "'member'",
      proof: "NULL",
      membership_stamp: "'0000000000000-000000-'",
      changed_at: "1",
      changed_by: "NULL",
      ...values,
    };
    return connection.exec(
      `INSERT INTO devices (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).join(", ")})`,
    );
  };

  it("takes a device the app could have written, and reads it back", async () => {
    const { database, connection } = await openTestDatabase();
    await insertDevice(connection, {});
    const { rows, origins } = await loadRows(database);
    const device = requireValue(rows.devices.values().next().value, "device");
    expect(device).toEqual({
      id: key,
      identity: { value: { relay: "https://relay.example/" }, stamp: LOWEST },
      name: { value: "Firefox on Linux", stamp: LOWEST },
      membership: { value: { status: "member", proof: null }, stamp: LOWEST },
    });
    expect(origins.devices.get(device.id)).toEqual({ changedAt: 1, changedBy: null });
  });

  it("writes a device through a change, and updates it with a later one", async () => {
    const { database } = await openTestDatabase();
    const device = createDevice("a", createStamp(1_763_200_000_000, 0, "phone"));
    const stored = { nodeId: NODE_ID, clock: LOWEST, counter: createChangeNumber(3) };
    const write = async (row: DeviceRow, origin: Origin) => {
      const change = { ...takeSnapshot(convertPlan(createEmptyPlan())), devices: [row] };
      const origins = { ...createEmptyOrigins(), devices: new Map([[row.id, origin]]) };
      const [first, ...rest] = buildChangeStatements(database, change, origins, stored, NOW);
      await database.batch([requireValue(first, "statement"), ...rest]);
    };
    const laptop = requireValue(parseDeviceKey("b".repeat(64)), "device key");
    await write(device, { changedAt: createChangeNumber(2), changedBy: laptop });
    expect((await loadRows(database)).rows.devices.get(device.id)).toEqual(device);
    const renamed: DeviceRow = {
      ...device,
      name: {
        value: requireValue(parseDeviceName("Phone"), "name"),
        stamp: createStamp(1_763_200_000_001, 0, "phone"),
      },
    };
    await write(renamed, { changedAt: createChangeNumber(3), changedBy: null });
    const { rows, origins } = await loadRows(database);
    expect(rows.devices.get(device.id)).toEqual(renamed);
    expect(origins.devices.get(device.id)).toEqual({ changedAt: 3, changedBy: null });
  });

  it("refuses to build a write for a row without its origin", async () => {
    const { database } = await openTestDatabase();
    const device = createDevice("a");
    const change = { ...takeSnapshot(convertPlan(createEmptyPlan())), devices: [device] };
    expect(() =>
      buildChangeStatements(
        database,
        change,
        createEmptyOrigins(),
        { nodeId: NODE_ID, clock: LOWEST, counter: NO_CHANGE },
        NOW,
      ),
    ).toThrow(/has no origin/u);
  });

  it("refuses values that break the rules", async () => {
    const { connection } = await openTestDatabase();
    const refused = [
      { id: "'phone'" },
      { id: `'${"A".repeat(64)}'` },
      { relay: "'ftp://relay.example/'" },
      { name: "''" },
      { name: `'${"n".repeat(61)}'` },
      { status: "'admin'" },
      { proof: "'signature'" },
      { membership_stamp: "'yesterday'" },
      { changed_by: "'phone'" },
    ];
    await Promise.all(
      refused.map((values) =>
        expect(insertDevice(connection, values)).rejects.toThrow(/CHECK constraint failed/u),
      ),
    );
    await expect(connection.exec(`INSERT INTO progress VALUES ('${key}', -1, 0)`)).rejects.toThrow(
      /CHECK constraint failed/u,
    );
  });
});

describe("the migration to the device list", () => {
  it("counts every row that's there as this device's change 1", async () => {
    const connection = await openOlderDatabase(2);
    const lowest = "'0000000000000-000000-'";
    await connection.exec(
      `INSERT INTO activities (id, name, name_stamp, hue, hue_stamp, shape, shape_stamp, mode, budget_minutes, days, budget_stamp, order_key, order_stamp, is_deleted, existence_stamp, created_at) VALUES ('work', 'Work', ${lowest}, 78, ${lowest}, 'square', ${lowest}, 'week', 720, 5, ${lowest}, 'V', ${lowest}, 0, ${lowest}, '2026-10-01T00:00:00Z')`,
    );
    await connection.exec(
      `INSERT INTO blocks (id, activity_id, is_deleted, existence_stamp, day, start, length, time_stamp) VALUES ('b1', 'work', 0, ${lowest}, 0, 600, 90, ${lowest})`,
    );
    await connection.exec(
      `INSERT INTO settings (id, day_start, day_start_stamp, day_end, day_end_stamp, example_loaded_at, example_loaded_at_stamp) VALUES (1, 6, ${lowest}, 23, ${lowest}, NULL, ${lowest})`,
    );
    await connection.exec(`INSERT INTO node VALUES (1, 'oldNode', ${lowest})`);

    expect(await runMigrations(connection)).toBe("migrated");
    const database = createDatabase(createLocalQueryService(() => Promise.resolve(connection)));
    const { rows, origins, node } = await loadRows(database);
    const work = requireValue(sanitizeActivityId("work"), "activity id");
    expect(rows.activities.get(work)?.name.value).toBe("Work");
    expect(rows.devices.size).toBe(0);
    const changeOne = { changedAt: 1, changedBy: null };
    expect(origins.activities.get(work)).toEqual(changeOne);
    expect(origins.blocks.values().toArray()).toEqual([changeOne]);
    expect(origins.settings).toEqual(changeOne);
    expect(node).toEqual({ nodeId: "oldNode", clock: LOWEST, counter: 1 });

    // The next save numbers its write after them.
    await save(database, (shown) => ({ ...shown, dayStart: sanitizeDayStart(8) }));
    expect((await loadRows(database)).origins.settings).toEqual({ changedAt: 2, changedBy: null });
  });
});

describe("the migration to stamps", () => {
  it("keeps a plan saved before stamps, with the lowest stamps and its order", async () => {
    const connection = await openOlderDatabase(1);
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
    const { rows, node, counter } = await loadRows(database);
    expect(node).toBeUndefined();
    // Without a node, the counter is the rows' latest change, which the migration made 1.
    expect(counter).toBe(1);
    const work = requireValue(sanitizeActivityId("work"), "activity id");
    expect(rows.activities.get(work)?.name.stamp).toBe(LOWEST);

    // The next save works on the migrated rows, and numbers its write after theirs.
    await saveAction(
      database,
      (shown) => ({ ...shown, dayStart: sanitizeDayStart(8) }),
      NOW,
      createNodeId,
    );
    expect((await loadPlan(database, createPredictableIds())).plan.dayStart).toBe(8);
    const saved = await loadRows(database);
    expect(saved.node?.counter).toBe(2);
    expect(saved.origins.settings).toEqual({ changedAt: 2, changedBy: null });
  });
});

describe("the node after an import", () => {
  const imported = requireValue(parseNodeId("newNode"), "node id");
  const later = requireValue(parseStamp("1900000000000-000004-elsewhere"), "stamp");
  const laterNode = { clock: later, counter: createChangeNumber(5) };

  it("gets a new id, and keeps the file's clock where it's later", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    const fileClock = requireValue(await loadNode(database), "node").clock;
    const renewed = { nodeId: "newNode", clock: fileClock, counter: 2 };
    expect(await renewNode(database, { clock: LOWEST, counter: NO_CHANGE }, imported)).toEqual(
      renewed,
    );
    expect(await loadNode(database)).toEqual(renewed);
  });

  it("keeps this browser's clock where it's later", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    expect(await renewNode(database, laterNode, imported)).toEqual({
      nodeId: "newNode",
      clock: later,
      counter: 6,
    });
  });

  it("takes this browser's clock and counter for a file that has no node yet", async () => {
    const { database } = await openTestDatabase();
    expect(await renewNode(database, laterNode, imported)).toEqual({
      nodeId: "newNode",
      clock: later,
      counter: 6,
    });
  });

  it("makes a node with the lowest clock when neither has one, counting past the file's rows", async () => {
    const connection = await openOlderDatabase(1);
    await connection.exec(
      "INSERT INTO activities VALUES ('work', 'Work', 78, 'square', 'week', 720, 5, 0, '2026-10-01T00:00:00Z')",
    );
    expect(await runMigrations(connection)).toBe("migrated");
    const database = createDatabase(createLocalQueryService(() => Promise.resolve(connection)));
    const renewed = { nodeId: "newNode", clock: LOWEST, counter: 2 };
    expect(await renewNode(database, undefined, imported)).toEqual(renewed);
    expect(await loadNode(database)).toEqual(renewed);
  });

  it("drops progress and every row's sender from a file without a node, as a crafted one can be", async () => {
    const { database, connection } = await openTestDatabase();
    await save(database, createExample);
    await connection.exec("DELETE FROM node");
    await connection.exec(`INSERT INTO progress VALUES ('${"b".repeat(64)}', 3, 2)`);
    await connection.exec(`UPDATE blocks SET changed_by = '${"b".repeat(64)}'`);
    await renewNode(database, undefined, imported);
    const { origins } = await loadRows(database);
    expect(new Set(origins.blocks.values().map((origin) => origin.changedBy))).toEqual(
      new Set([null]),
    );
    const statement = await connection.prepare("SELECT count(*) AS count FROM progress");
    expect(await statement.get()).toEqual({ count: 0 });
  });

  it("counts every row as changed here at the new counter, and drops the file's progress", async () => {
    const { database, connection } = await openTestDatabase();
    await save(database, createExample);
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }));
    await connection.exec(`INSERT INTO progress VALUES ('${"b".repeat(64)}', 3, 2)`);
    await connection.exec(`UPDATE blocks SET changed_by = '${"b".repeat(64)}'`);
    await renewNode(database, laterNode, imported);
    const { origins } = await loadRows(database);
    const renewed = { changedAt: 6, changedBy: null };
    expect(new Set(origins.blocks.values().map((origin) => JSON.stringify(origin)))).toEqual(
      new Set([JSON.stringify(renewed)]),
    );
    expect(origins.settings).toEqual(renewed);
    const statement = await connection.prepare("SELECT count(*) AS count FROM progress");
    expect(await statement.get()).toEqual({ count: 0 });
  });

  it("stamps the next save with the new id, later than both clocks", async () => {
    const { database } = await openTestDatabase();
    await save(database, createExample);
    await renewNode(database, laterNode, imported);
    await save(database, (plan) => ({ ...plan, dayStart: sanitizeDayStart(6) }));
    const { rows, node } = await loadRows(database);
    expect(rows.settings.dayStart.stamp.endsWith("-newNode")).toBe(true);
    expect(rows.settings.dayStart.stamp > later).toBe(true);
    expect(node?.clock).toBe(rows.settings.dayStart.stamp);
  });
});
