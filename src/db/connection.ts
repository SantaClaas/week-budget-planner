export type SqlValue = string | number | bigint | null | Uint8Array;

/** One statement for {@link QueryService.batch}, as Drizzle's sqlite-proxy hands it over. */
export type BatchStatement = { sql: string; params: SqlValue[]; method: QueryMethod };

/** Drizzle's sqlite-proxy execute methods. */
export type QueryMethod = "run" | "all" | "get" | "values";

/**
 * What Drizzle's sqlite-proxy expects back: rows as arrays of column values in column order. For
 * "get" it is one row (or undefined), otherwise a list of rows; "run" returns no rows.
 */
export type QueryResult = { rows: unknown[] };

/**
 * The SQL surface every tab uses. The leader tab runs it on its local database; other tabs reach
 * it over a BroadcastChannel (see client.ts), so every method is async and every value is
 * structured-cloneable.
 */
export type QueryService = {
  query(sql: string, params: SqlValue[], method: QueryMethod): Promise<QueryResult>;
  /** Runs every statement in one transaction, rolling back if any fails. */
  batch(statements: BatchStatement[]): Promise<QueryResult[]>;
};

/** The subset of the Turso database API this app uses. Both the wasm and the Node package fit it. */
export interface TursoConnection {
  exec(sql: string): Promise<void>;
  prepare(sql: string): Promise<TursoStatement>;
  close(): Promise<void>;
}

export interface TursoStatement {
  raw(raw?: boolean): this;
  run(...params: SqlValue[]): Promise<unknown>;
  get(...params: SqlValue[]): Promise<unknown>;
  all(...params: SqlValue[]): Promise<unknown[]>;
}

async function execute(
  connection: TursoConnection,
  sql: string,
  params: SqlValue[],
  method: QueryMethod,
): Promise<QueryResult> {
  const statement = await connection.prepare(sql);
  if (method === "run") {
    await statement.run(...params);
    return { rows: [] };
  }
  statement.raw(true);
  if (method === "get") {
    // One row, or undefined when nothing matched; Drizzle handles both.
    return { rows: (await statement.get(...params)) as unknown[] };
  }
  return { rows: await statement.all(...params) };
}

/** The {@link QueryService} for a local connection: the leader tab's, or a test database. */
export function localQueryService(getConnection: () => Promise<TursoConnection>): QueryService {
  return {
    async query(sql, params, method) {
      return execute(await getConnection(), sql, params, method);
    },
    async batch(statements) {
      const connection = await getConnection();
      await connection.exec("BEGIN");
      try {
        const results: QueryResult[] = [];
        for (const { sql, params, method } of statements) {
          results.push(await execute(connection, sql, params, method));
        }
        await connection.exec("COMMIT");
        return results;
      } catch (error) {
        await connection.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
