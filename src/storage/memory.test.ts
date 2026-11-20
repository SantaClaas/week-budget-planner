import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import * as memory from "./memory.ts";
import { createPredictableIds } from "../plan/test-data.ts";

const NOW = Temporal.Instant.from("2026-10-15T08:00:00Z");

const createExample = () => createExampleWeek(NOW, createPredictableIds());

describe("memory store", () => {
  it("keeps the plan only in memory", async () => {
    const store = memory.create();
    expect(store.level).toBe("none");
    expect(await store.load()).toMatchObject({ isStored: false });
    expect(await store.save(undefined, createExample(), NOW)).toBe("saved");
    expect(await store.load()).toEqual({ plan: createExample(), isStored: true });
    expect(await store.wipe()).toBe("wiped");
    expect(await store.load()).toMatchObject({ isStored: false });
  });
});
