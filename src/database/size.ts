import type { Result } from "../result.ts";
import type { QueryService } from "./connection.ts";

/** The one number in a pragma's row, or 0 when it isn't one. */
function readNumber(rows: unknown[]): number {
  const [value] = rows;
  if (typeof value === "number") return value;
  return typeof value === "bigint" ? Number(value) : 0;
}

/**
 * How big the database is, in bytes: its pages times their size, as SQLite counts them. That's the
 * file an export saves, once the write-ahead log is checkpointed into it.
 */
export async function measure(service: QueryService): Promise<Result<number, "newer-version">> {
  const pages = await service.query("PRAGMA page_count", [], "get");
  if (pages === "newer-version") return pages;
  const pageSize = await service.query("PRAGMA page_size", [], "get");
  if (pageSize === "newer-version") return pageSize;
  return readNumber(pages.rows) * readNumber(pageSize.rows);
}
