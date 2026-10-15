import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import type { QueryService } from "./connection";

export type Database = SqliteRemoteDatabase;

/**
 * The app's Drizzle instance. It has no database of its own: Drizzle builds the SQL and hands it to
 * the query service, which runs it on the leader tab's database (locally or over the broadcast
 * channel). Multi-statement actions use `database.batch([...])`, which the service runs in one
 * transaction on the leader, so no other tab's query can land in between.
 */
export function createDatabase(service: QueryService): Database {
  return drizzle(
    (sql, parameters, method) => service.query(sql, parameters, method),
    (statements) => service.batch(statements),
  );
}
