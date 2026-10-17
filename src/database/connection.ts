type SqlValue = string | number | bigint | null | Uint8Array;

/**
 * One statement for {@link QueryService.batch}, as Drizzle's sqlite-proxy hands it over. `params` is
 * Drizzle's name, so it stays abbreviated here.
 */
type BatchStatement = { sql: string; params: SqlValue[]; method: QueryMethod };

/** Drizzle's sqlite-proxy execute methods. */
type QueryMethod = "run" | "all" | "get" | "values";

/**
 * What Drizzle's sqlite-proxy expects back: rows as arrays of column values in column order. For
 * "get" it is one row (or undefined), otherwise a list of rows; "run" returns no rows.
 */
type QueryResult = { rows: unknown[] };

/**
 * The SQL surface every tab uses. The leader tab runs it on its local database; other tabs reach
 * it over a BroadcastChannel (see client.ts), so every method is async and every value is
 * structured-cloneable.
 */
export type QueryService = {
  query(sql: string, parameters: SqlValue[], method: QueryMethod): Promise<QueryResult>;
  /** Runs every statement in one transaction, rolling back if any fails. */
  batch(statements: BatchStatement[]): Promise<QueryResult[]>;
};

/** The subset of the Turso database API this app uses. Both the wasm and the Node package fit it. */
export interface TursoConnection {
  exec(sql: string): Promise<void>;
  prepare(sql: string): Promise<TursoStatement>;
  close(): Promise<void>;
}

interface TursoStatement {
  raw(raw?: boolean): this;
  run(...parameters: SqlValue[]): Promise<unknown>;
  get(...parameters: SqlValue[]): Promise<unknown>;
  all(...parameters: SqlValue[]): Promise<unknown[]>;
}

async function execute(
  connection: TursoConnection,
  sql: string,
  parameters: SqlValue[],
  method: QueryMethod,
): Promise<QueryResult> {
  const statement = await connection.prepare(sql);
  if (method === "run") {
    await statement.run(...parameters);
    return { rows: [] };
  }
  statement.raw(true);
  if (method === "get") {
    // One row, or undefined when nothing matched. Drizzle handles both, though its type only
    // names the row.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    return { rows: (await statement.get(...parameters)) as unknown[] };
  }
  return { rows: await statement.all(...parameters) };
}

/** The {@link QueryService} for a local connection: the leader tab's, or a test database. */
export function createLocalQueryService(
  getConnection: () => Promise<TursoConnection>,
): QueryService {
  return {
    async query(sql, parameters, method) {
      return execute(await getConnection(), sql, parameters, method);
    },
    async batch(statements) {
      const connection = await getConnection();
      await connection.exec("BEGIN");
      try {
        const results: QueryResult[] = [];
        for (const { sql, params: parameters, method } of statements) {
          // One after another, in order, inside the transaction.
          // oxlint-disable-next-line no-await-in-loop -- see above
          results.push(await execute(connection, sql, parameters, method));
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
