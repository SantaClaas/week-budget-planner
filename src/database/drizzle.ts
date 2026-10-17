import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

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
 * The app's Drizzle instance. It has no database of its own: Drizzle builds the SQL and hands it to
 * the query service, which runs it on the leader tab's database (locally or over the broadcast
 * channel). Multi-statement actions use `database.batch([...])`, which the service runs in one
 * transaction on the leader, so no other tab's query can land in between.
 */
export function createDatabase(service: QueryService): Database {
  return drizzle(
    (sql, parameters: unknown[], method) => service.query(sql, checkParameters(parameters), method),
    (statements) => service.batch(statements),
  );
}
