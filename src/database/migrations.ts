import type { TursoConnection } from "./connection";

/** Drizzle's table of applied migrations. It holds one row per migration, by name. */
const MIGRATIONS_TABLE = "__drizzle_migrations";

// The SQL drizzle-kit generated into drizzle/<timestamp>_<name>/migration.sql. Each file becomes a
// chunk of its own, downloaded only when a database still needs it, so migrations that every
// database already has cost nothing but their name.
const loaders = import.meta.glob<string>("../../drizzle/*/migration.sql", { query: "?raw", import: "default" });

/** A migration's name is its folder name, which starts with the timestamp the migrator sorts by. */
const readName = (path: string) => path.split("/").at(-2)!;

const loaderByName = new Map(Object.entries(loaders).map(([path, load]) => [readName(path), load]));

/** Every migration this version of the app knows, oldest first. */
export const MIGRATION_NAMES: readonly string[] = [...loaderByName.keys()].sort();

async function readAppliedNames(connection: TursoConnection): Promise<Set<string>> {
  const tables = await (
    await connection.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${MIGRATIONS_TABLE}'`)
  )
    .raw(true)
    .all();
  if (tables.length === 0) return new Set();
  const rows = (await (await connection.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)).raw(true).all()) as [
    string | null,
  ][];
  return new Set(rows.flatMap(([name]) => (name === null ? [] : [name])));
}

/**
 * Applies pending migrations to a real database connection (the leader tab's, an imported copy, or
 * a test database). A database that is up to date costs one query: the migrator and the SQL are
 * only loaded for migrations it doesn't have yet. Safe to run on every open.
 */
export async function runMigrations(connection: TursoConnection): Promise<void> {
  const applied = await readAppliedNames(connection);
  const pending = MIGRATION_NAMES.filter((name) => !applied.has(name));
  if (pending.length === 0) return;

  const [{ migrate }, driverCore, files] = await Promise.all([
    import("drizzle-orm/tursodatabase/wasm-migrator"),
    import("drizzle-orm/tursodatabase/driver-core"),
    Promise.all(pending.map((name) => loaderByName.get(name)!())),
  ]);
  // `construct` wraps an already open Turso client in Drizzle's Turso driver. It is exported at
  // runtime but missing from the type declarations. Using it (rather than drizzle-orm/tursodatabase/wasm)
  // avoids importing a second entry point of @tursodatabase/database-wasm next to the Vite one.
  const { construct } = driverCore as unknown as { construct(client: unknown): Parameters<typeof migrate>[0] };
  // Drizzle runs every migration whose name isn't in its table, so only the pending ones are passed.
  const migrations = Object.fromEntries(pending.map((name, index) => [name, files[index]!]));
  const result = await migrate(construct(connection), { migrations });
  if (result) throw new Error(`Database migration failed: ${JSON.stringify(result)}`);
}
