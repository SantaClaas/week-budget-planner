import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import * as memory from "./memory.ts";
import { createPredictableIds } from "../plan/test-data.ts";

const NOW = Temporal.Instant.from("2026-10-15T08:00:00Z");

const example = () => createExampleWeek(NOW, createPredictableIds());

describe("memory store", () => {
  it("keeps the plan only in memory", async () => {
    const store = memory.create();
    expect(store.level).toBe("none");
    expect(await store.load()).toMatchObject({ isStored: false });
    await store.save(undefined, example(), NOW);
    expect((await store.load()).plan).toEqual(example());
    await store.wipe();
    expect(await store.load()).toMatchObject({ isStored: false });
  });
});
