import * as driverCore from "drizzle-orm/tursodatabase/driver-core";
import type { TursoDatabaseDatabase } from "drizzle-orm/tursodatabase/driver-core";
import { migrate } from "drizzle-orm/tursodatabase/wasm-migrator";

import type { TursoConnection } from "./connection";

// `construct` wraps an already open Turso client in Drizzle's Turso driver. It is exported at
// runtime but missing from the type declarations. Using it (rather than drizzle-orm/tursodatabase/wasm)
// avoids importing a second entry point of @tursodatabase/database-wasm next to the Vite one.
const { construct } = driverCore as unknown as {
  construct(client: unknown): TursoDatabaseDatabase;
};

// The SQL drizzle-kit generated into drizzle/<timestamp>_<name>/migration.sql, bundled as text.
const files = import.meta.glob<string>("../../drizzle/*/migration.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Migrations keyed by their folder name, which starts with the timestamp the migrator sorts by. */
export const MIGRATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, sql]) => [path.split("/").at(-2)!, sql]),
);

/**
 * Applies pending migrations to a real database connection (the leader tab's, or a test
 * database). Drizzle records applied migrations in its own table, so this is safe to run on every
 * open and on imported files from older versions.
 */
export async function runMigrations(connection: TursoConnection): Promise<void> {
  const result = await migrate(construct(connection), { migrations: MIGRATIONS });
  if (result) throw new Error(`Database migration failed: ${JSON.stringify(result)}`);
}
