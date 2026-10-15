import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example";
import * as memory from "./memory";

const example = () => createExampleWeek(new Date("2026-10-15T08:00:00Z"));

describe("memory store", () => {
  it("keeps the plan only in memory", async () => {
    const store = memory.create();
    expect(store.level).toBe("none");
    expect(await store.load()).toMatchObject({ isStored: false });
    await store.save(undefined, example());
    expect((await store.load()).plan).toEqual(example());
    await store.wipe();
    expect(await store.load()).toMatchObject({ isStored: false });
  });
});
