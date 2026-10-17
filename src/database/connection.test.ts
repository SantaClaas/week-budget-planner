import { connect } from "@tursodatabase/database";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createLocalQueryService, isSqlValue } from "./connection.ts";
import { createDatabase } from "./drizzle.ts";

// Drizzle types query parameters as `any[]`, so the app checks them at runtime instead (see Where
// rules are enforced in docs/CODING-GUIDELINES.md).

describe("query parameters", () => {
  it("accepts exactly the values SQLite can store", () => {
    for (const value of ["text", 1.5, 2n, null, new Uint8Array([1])])
      expect(isSqlValue(value)).toBe(true);
    for (const value of [undefined, true, {}, [], new Date(0), () => 0])
      expect(isSqlValue(value)).toBe(false);
  });

  it("refuses a query with a parameter SQLite can't store", async () => {
    const connection = await connect(":memory:");
    const database = createDatabase(createLocalQueryService(() => Promise.resolve(connection)));
    await expect(database.run(sql`SELECT ${{ not: "a value" }}`)).rejects.toThrow(
      /Can't store object/u,
    );
    await expect(database.get(sql`SELECT ${"fine"} AS value`)).resolves.toEqual(["fine"]);
  });
});
