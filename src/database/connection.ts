import type { Result } from "../result.ts";

/** A value SQLite can store, as Drizzle and Turso pass them. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export const isSqlValue = (value: unknown): value is SqlValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "bigint" ||
  value instanceof Uint8Array;

/** Drizzle's sqlite-proxy execute methods. */
type QueryMethod = "run" | "all" | "get" | "values";

/**
 * One statement for {@link QueryService.batch}, as Drizzle's sqlite-proxy hands it over. `params` is
 * Drizzle's name, so it stays abbreviated here.
 */
type BatchStatement = { sql: string; params: SqlValue[]; method: QueryMethod };

/**
 * What Drizzle's sqlite-proxy expects back: rows as arrays of column values in column order. For
 * "get" it is one row (or undefined), otherwise a list of rows; "run" returns no rows.
 */
type QueryResult = { rows: unknown[] };

/**
 * The SQL surface every tab uses. The leader tab runs it on its local database; other tabs reach
 * it over a BroadcastChannel (see client.ts), so every method is async and every value is
 * structured-cloneable. Each gives back "newer-version" instead of rows when a newer version of
 * the app made the database or runs in another tab, so nothing was run.
 */
export type QueryService = {
  query(
    sql: string,
    parameters: SqlValue[],
    method: QueryMethod,
  ): Promise<Result<QueryResult, "newer-version">>;
  /** Runs every statement in one transaction, rolling back if any fails. */
  batch(statements: BatchStatement[]): Promise<Result<QueryResult[], "newer-version">>;
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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- Drizzle's type names only the row, but it takes undefined for no row.
    return { rows: (await statement.get(...parameters)) as unknown[] };
  }
  return { rows: await statement.all(...parameters) };
}

/** A transaction: commit() keeps its statements, and disposing it uncommitted rolls them back. */
type Transaction = AsyncDisposable & { commit(): Promise<void> };

/**
 * Starts a transaction on the connection. Declared with `await using`, everything since rolls back
 * however the scope ends, a programming mistake included, unless commit() ran first.
 */
async function startTransaction(connection: TursoConnection): Promise<Transaction> {
  await connection.exec("BEGIN");
  let isCommitted = false;
  return {
    async commit() {
      await connection.exec("COMMIT");
      isCommitted = true;
    },
    async [Symbol.asyncDispose]() {
      if (isCommitted) return;
      await connection.exec("ROLLBACK");
    },
  };
}

/**
 * The {@link QueryService} for a local connection: the leader tab's, or a test database.
 * `getConnection` gives back "newer-version" for a database that a newer version of the app made.
 */
export function createLocalQueryService(
  getConnection: () => Promise<Result<TursoConnection, "newer-version">>,
): QueryService {
  return {
    async query(sql, parameters, method) {
      const connection = await getConnection();
      if (connection === "newer-version") return connection;
      return execute(connection, sql, parameters, method);
    },
    async batch(statements) {
      const connection = await getConnection();
      if (connection === "newer-version") return connection;
      await using transaction = await startTransaction(connection);
      const results: QueryResult[] = [];
      for (const { sql, params: parameters, method } of statements) {
        // One after another, in order, inside the transaction.
        // oxlint-disable-next-line no-await-in-loop -- a transaction runs its statements in order.
        results.push(await execute(connection, sql, parameters, method));
      }
      await transaction.commit();
      return results;
    },
  };
}
