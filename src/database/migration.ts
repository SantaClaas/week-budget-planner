import type { Result } from "../result.ts";
import type { TursoConnection } from "./connection.ts";

/** Drizzle's table of applied migrations. It holds one row per migration, by name. */
const MIGRATIONS_TABLE = "__drizzle_migrations";

// The SQL drizzle-kit generated into drizzle/<timestamp>_<name>/migration.sql. Each file becomes a
// chunk of its own, downloaded only when a database still needs it, so migrations that every
// database already has cost nothing but their name.
const loaders = import.meta.glob<string>("../../drizzle/*/migration.sql", {
  query: "?raw",
  import: "default",
});

/** A migration's name is its folder name, which starts with the timestamp the migrator sorts by. */
const readName = (path: string): string => path.split("/").at(-2) ?? path;

const loaderByName = new Map(Object.entries(loaders).map(([path, load]) => [readName(path), load]));

/** Every migration this version of the app knows, oldest first. */
export const MIGRATION_NAMES: readonly string[] = loaderByName.keys().toArray().toSorted();

async function readAppliedNames(connection: TursoConnection): Promise<Set<string>> {
  const tables = await (
    await connection.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${MIGRATIONS_TABLE}'`,
    )
  )
    .raw(true)
    .all();
  if (tables.length === 0) return new Set();
  const rows = await (
    await connection.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
  )
    .raw(true)
    .all();
  return new Set(
    rows.flatMap((row) => (Array.isArray(row) && typeof row[0] === "string" ? [row[0]] : [])),
  );
}

/**
 * Applies pending migrations to a real database connection (the leader tab's, an imported copy, or
 * a test database). A database that is up to date costs one query: the migrator and the SQL are
 * only loaded for migrations it doesn't have yet. Safe to run on every open. "newer-version" when
 * the database has migrations this version of the app doesn't know: a newer version made or
 * upgraded it, and opening it could misread or damage it, so nothing is run.
 */
export async function runMigrations(
  connection: TursoConnection,
): Promise<Result<"migrated", "newer-version">> {
  const applied = await readAppliedNames(connection);
  if (applied.values().some((name) => !loaderByName.has(name))) return "newer-version";
  const pending = loaderByName
    .entries()
    .filter(([name]) => !applied.has(name))
    .toArray();
  if (pending.length === 0) return "migrated";

  const [{ migrate }, driverCore, files] = await Promise.all([
    import("drizzle-orm/tursodatabase/wasm-migrator"),
    import("drizzle-orm/tursodatabase/driver-core"),
    Promise.all(pending.map(async ([name, load]) => [name, await load()] as const)),
  ]);
  // `construct` wraps an already open Turso client in Drizzle's Turso driver. It is exported at
  // runtime but missing from the type declarations. Using it (rather than drizzle-orm/tursodatabase/wasm)
  // avoids importing a second entry point of @tursodatabase/database-wasm next to the Vite one.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- construct() exists at runtime, but Drizzle's types leave it out.
  const driver = driverCore as unknown as {
    construct(client: unknown): Parameters<typeof migrate>[0];
  };
  // Drizzle runs every migration whose name isn't in its table, so only the pending ones are passed.
  const migrations = Object.fromEntries(files);
  const result = await migrate(driver.construct(connection), { migrations });
  if (result) throw new Error(`Database migration failed: ${JSON.stringify(result)}`);
  return "migrated";
}
