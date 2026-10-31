import { describe, expect, it } from "vitest";

import { createPredictableIds } from "../plan/test-data.ts";
import type { QueryService } from "./connection.ts";
import { createDatabase, runOnDatabase } from "./drizzle.ts";
import { loadPlan } from "./plan-repository.ts";

// Drizzle's proxy callback can only throw, so a newer version crosses Drizzle as an error and
// comes back as a value. These run real Drizzle queries, which wrap errors on the way.

/** A query service that answers every query with `answer`. */
const createService = (answer: () => Promise<"newer-version">): QueryService => ({
  query: answer,
  batch: answer,
});

describe("queries through Drizzle", () => {
  it("give back newer-version as a value, through Drizzle's own error", async () => {
    const database = createDatabase(createService(() => Promise.resolve("newer-version")));
    expect(await runOnDatabase(() => loadPlan(database, createPredictableIds()))).toBe(
      "newer-version",
    );
  });

  it("still throw every other error", async () => {
    const database = createDatabase(
      createService(() => Promise.reject(new Error("The disk is full."))),
    );
    await expect(runOnDatabase(() => loadPlan(database, createPredictableIds()))).rejects.toThrow(
      "Failed query",
    );
  });
});
