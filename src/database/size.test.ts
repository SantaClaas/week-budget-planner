import { connect } from "@tursodatabase/database";
import { describe, expect, it } from "vitest";

import { createLocalQueryService } from "./connection.ts";
import * as size from "./size.ts";

describe("the database's size", () => {
  it("is its pages times their size, and grows with what it holds", async () => {
    const connection = await connect(":memory:");
    const service = createLocalQueryService(() => Promise.resolve(connection));
    const empty = await size.measure(service);
    await connection.exec("CREATE TABLE note (text TEXT)");
    await connection.exec(`INSERT INTO note VALUES ('${"x".repeat(20_000)}')`);
    const filled = await size.measure(service);
    expect(empty).toBeTypeOf("number");
    expect(Number(empty) % 4096).toBe(0);
    expect(Number(filled)).toBeGreaterThan(Number(empty));
  });

  it("gives back newer-version when a newer version of the app made the database", async () => {
    const service = createLocalQueryService(() => Promise.resolve("newer-version" as const));
    expect(await size.measure(service)).toBe("newer-version");
  });
});
