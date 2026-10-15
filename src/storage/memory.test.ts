import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { sanitizePlan } from "../plan/sanitize";
import * as memory from "./memory";

const example = () => sanitizePlan(exampleWeek);

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
