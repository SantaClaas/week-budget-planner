// Rebuilding an imported database into a fresh one made by the app's own migrations, so no byte of
// the imported file's schema (triggers, views, extra tables or tables missing constraints) is kept
// (see Export, import and reset in docs/spec/persistence.md).
import { getColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { parse as parseChange } from "../merge/check.ts";
import { findLatestStamp, takeSnapshot } from "../merge/index.ts";
import { read as readStamp, type NodeId, type Stamp } from "../merge/stamp.ts";
import type { Result } from "../result.ts";
import {
  createLocalQueryService,
  isSqlValue,
  startTransaction,
  type SqlValue,
  type TursoConnection,
} from "./connection.ts";
import { createDatabase } from "./drizzle.ts";
import { hasAppliedMigrations, runMigrations } from "./migration.ts";
import { loadRows, renewNode } from "./plan-repository.ts";
import { activities, blocks, node, settings } from "./schema.ts";

/** Why a file can't be imported. */
export type ImportProblem = "invalid-file" | "newer-version";

/** The tables an import copies, parents before children so foreign keys hold while inserting. */
export const IMPORTED_TABLES: readonly { table: SQLiteTable; isSingleRow: boolean }[] = [
  { table: activities, isSingleRow: false },
  { table: blocks, isSingleRow: false },
  { table: settings, isSingleRow: true },
  { table: node, isSingleRow: true },
];

/** The id of the single row in `settings` and `node`. */
const SINGLE_ROW_ID = 1;

/**
 * How far ahead of this browser's wall clock an imported file's stamps or node clock may be. Wide
 * enough for normal clock drift or a misconfigured timezone, while refusing crafted far-future
 * clocks that would make every later edit win merges or exhaust the stamp range.
 */
const MAX_CLOCK_AHEAD = { hours: 24 } as const;

/** Whether a stamp's time is further ahead of `now` than {@link MAX_CLOCK_AHEAD} allows. */
const isFarInFuture = (stamp: Stamp, now: Temporal.Instant): boolean =>
  readStamp(stamp).time > now.add(MAX_CLOCK_AHEAD).epochMilliseconds;

/** Checks that a raw SQLite row holds the expected number of values SQLite can store. */
function readRow(row: unknown, columnCount: number, tableName: string): SqlValue[] {
  if (!Array.isArray(row) || row.length !== columnCount) {
    throw new Error(`Unexpected row shape in ${tableName}.`);
  }

  return row.map((value) => {
    if (!isSqlValue(value)) {
      throw new TypeError(`Unexpected ${typeof value} value in ${tableName}.`);
    }

    return value;
  });
}

/**
 * Copies every row of one table from `source` into `target`, column by column, by the names in
 * `schema.ts`. Reading raw values keeps invalid values such as `is_deleted = 2` from being turned
 * into booleans before `target`'s `CHECK` and `STRICT` rules refuse them.
 */
async function copyTable(
  source: TursoConnection,
  target: TursoConnection,
  table: SQLiteTable,
  isSingleRow: boolean,
): Promise<void> {
  const name = getTableName(table);
  const columns = Object.values(getColumns(table)).map((column) => column.name);
  const quotedColumns = columns
    .values()
    .map((column) => `"${column}"`)
    .reduce((joined, column) => `${joined}, ${column}`);
  const placeholders = columns
    .values()
    .map(() => "?")
    .reduce((joined, placeholder) => `${joined}, ${placeholder}`);
  const select = await source.prepare(`SELECT ${quotedColumns} FROM "${name}"`);
  const rows = await select.raw(true).all();
  if (isSingleRow && rows.length > 1) {
    throw new Error(`Expected at most one row in ${name}.`);
  }

  const insert = await target.prepare(
    `INSERT INTO "${name}" (${quotedColumns}) VALUES (${placeholders})`,
  );
  const idIndex = columns.indexOf("id");
  for (const rawRow of rows) {
    const values = readRow(rawRow, columns.length, name);
    if (isSingleRow && values[idIndex] !== SINGLE_ROW_ID) {
      throw new Error(`Expected row id ${String(SINGLE_ROW_ID)} in ${name}.`);
    }

    // oxlint-disable-next-line no-await-in-loop -- rows are inserted in order inside one transaction.
    await insert.run(...values);
  }
}

/**
 * Copies every table's rows into `target` in one transaction with foreign keys on, so every
 * `STRICT`, `CHECK`, `PRIMARY KEY` and `FOREIGN KEY` constraint on `target` runs on every row.
 */
async function copyRows(source: TursoConnection, target: TursoConnection): Promise<void> {
  await target.exec("PRAGMA foreign_keys = ON");
  await using transaction = await startTransaction(target);
  for (const { table, isSingleRow } of IMPORTED_TABLES) {
    // oxlint-disable-next-line no-await-in-loop -- parent tables must be copied before children so foreign keys hold.
    await copyTable(source, target, table, isSingleRow);
  }

  await transaction.commit();
}

/**
 * Checks that `source` is a Week Budget Planner database and migrates it when older. Returns
 * `"invalid-file"` when it has no applied migrations or can't be migrated, `"newer-version"` when
 * it lists a migration this version doesn't have.
 */
async function migrateSource(source: TursoConnection): Promise<Result<"migrated", ImportProblem>> {
  let hasMigrations: boolean;
  try {
    hasMigrations = await hasAppliedMigrations(source);
  } catch (error) {
    console.warn("[database] couldn't read the imported file's migrations", error);
    return "invalid-file";
  }

  if (!hasMigrations) return "invalid-file";

  try {
    return await runMigrations(source);
  } catch (error) {
    console.warn("[database] couldn't migrate the imported file", error);
    return "invalid-file";
  }
}

/**
 * Rebuilds an imported database into a fresh `target` connection: checks and migrates `source`,
 * creates the schema on `target` from this version's migrations, copies every row through
 * `target`'s constraints, verifies the rows with the merge's strict check and refuses stamps or a
 * node clock far ahead of `now`, then gives the node a new id and the later clock. No byte of
 * `source`'s schema is kept.
 *
 * @param source - A copy of the imported file, opened on its own.
 * @param target - A brand-new empty database to build the replacement in.
 * @param clock - This browser's clock before the import, or undefined before its first save.
 * @param nodeId - The new node id for this browser.
 * @param now - When the import ran, to refuse files whose stamps or node clock are far ahead.
 */
export async function rebuild(
  source: TursoConnection,
  target: TursoConnection,
  clock: Stamp | undefined,
  nodeId: NodeId,
  now: Temporal.Instant,
): Promise<Result<"rebuilt", ImportProblem>> {
  const migrated = await migrateSource(source);
  if (migrated !== "migrated") return migrated;

  if ((await runMigrations(target)) !== "migrated") {
    throw new Error("A fresh database should always migrate.");
  }

  try {
    await copyRows(source, target);
  } catch (error) {
    console.warn("[database] couldn't copy the imported rows into a fresh database", error);
    return "invalid-file";
  }

  // `copyRows` already enforced `target`'s `STRICT`, `CHECK` and `FOREIGN KEY` constraints on raw
  // values (including `is_deleted IN (0, 1)` before Drizzle maps integers to booleans). `loadRows`
  // reads stored values without repairing them, so `parseChange` catches what SQLite's `CHECK`
  // constraints don't express (such as whitespace-only activity names and invalid `example_loaded_at`).
  const targetDatabase = createDatabase(createLocalQueryService(() => Promise.resolve(target)));
  const { rows, node: importedNode } = await loadRows(targetDatabase);
  const snapshot = takeSnapshot(rows);
  if (typeof parseChange(snapshot) === "string") return "invalid-file";

  if (
    isFarInFuture(findLatestStamp(snapshot), now) ||
    (importedNode !== undefined && isFarInFuture(importedNode.clock, now))
  ) {
    return "invalid-file";
  }

  await renewNode(targetDatabase, clock, nodeId);
  return "rebuilt";
}
