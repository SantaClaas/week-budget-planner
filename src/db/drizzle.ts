import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import type { QueryService } from "./connection";

export type Db = SqliteRemoteDatabase;

/**
 * The app's Drizzle instance. It has no database of its own: Drizzle builds the SQL and hands it to
 * the query service, which runs it on the leader tab's database (locally or over the broadcast
 * channel). Multi-statement actions use `db.batch([...])`, which the service runs in one
 * transaction on the leader, so no other tab's query can land in between.
 */
export function createDb(service: QueryService): Db {
  return drizzle(
    (sql, params, method) => service.query(sql, params, method),
    (statements) => service.batch(statements),
  );
}
