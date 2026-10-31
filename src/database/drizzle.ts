import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import type { Result } from "../result.ts";
import { isSqlValue, type QueryService, type SqlValue } from "./connection.ts";

export type Database = SqliteRemoteDatabase;

/** Drizzle types its parameters as `any[]`. Every one has to be a value SQLite can store. */
function checkParameters(parameters: unknown[]): SqlValue[] {
  return parameters.map((parameter) => {
    if (!isSqlValue(parameter)) throw new TypeError(`Can't store ${typeof parameter} in SQLite.`);
    return parameter;
  });
}

/**
 * Drizzle's proxy callback can only give back rows or throw, so this carries a query service's
 * "newer-version" through Drizzle. It never leaves this module: {@link runOnDatabase} turns it back
 * into the value.
 */
class NewerVersionThroughDrizzle extends Error {}

/** Whether the error, or one it wraps, is a newer version: Drizzle wraps a failed query's error. */
function isNewerVersion(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause instanceof NewerVersionThroughDrizzle) return true;
  }
  return false;
}

/** The service's answer as Drizzle takes it: the rows, or a throw for "newer-version". */
function readRows<Rows>(answer: Result<Rows, "newer-version">): Rows {
  if (answer === "newer-version") {
    throw new NewerVersionThroughDrizzle("A newer version of the app has the database.");
  }
  return answer;
}

/**
 * Runs Drizzle queries on a database from {@link createDatabase}, and gives back "newer-version"
 * instead of their result when a newer version of the app made the database or runs in another
 * tab. Every other error still throws.
 */
export async function runOnDatabase<Value>(
  queries: () => Promise<Value>,
): Promise<Result<Value, "newer-version">> {
  try {
    return await queries();
  } catch (error) {
    if (isNewerVersion(error)) return "newer-version";
    throw error;
  }
}

/**
 * The app's Drizzle instance. It has no database of its own: Drizzle builds the SQL and hands it to
 * the query service, which runs it on the leader tab's database (locally or over the broadcast
 * channel). Multi-statement actions use `database.batch([...])`, which the service runs in one
 * transaction on the leader, so no other tab's query can land in between. Run its queries through
 * {@link runOnDatabase}, which turns a newer version back into a value.
 */
export function createDatabase(service: QueryService): Database {
  return drizzle(
    // The parameters are checked before the query starts, so a bad one throws as it is, unwrapped.
    (sql, parameters: unknown[], method) =>
      service.query(sql, checkParameters(parameters), method).then(readRows),
    (statements) => service.batch(statements).then(readRows),
  );
}
