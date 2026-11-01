import { describe, expect, it } from "vitest";

import { createExampleWeek, keepExampleWeek, startEmpty } from "./example.ts";
import { createDayHours, createPredictableIds } from "./test-data.ts";

const now = Temporal.Instant.from("2026-10-20T08:00:00Z");

describe("example week", () => {
  it("is marked as loaded at the moment it was loaded", () => {
    const example = createExampleWeek(now, createPredictableIds());
    expect(example.exampleLoadedAt).toBe("2026-10-20T08:00:00Z");
    expect(example.activities.length).toBeGreaterThan(0);
  });

  it("keeps its activities and blocks when kept", () => {
    const example = createExampleWeek(now, createPredictableIds());
    const kept = keepExampleWeek(example);
    expect(kept).toEqual({ ...example, exampleLoadedAt: null });
    expect(keepExampleWeek(kept)).toBe(kept);
  });

  it("starts empty with the same day hours", () => {
    const example = { ...createExampleWeek(now, createPredictableIds()), ...createDayHours(6, 23) };
    expect(startEmpty(example)).toEqual({
      version: 1,
      activities: [],
      blocks: [],
      ...createDayHours(6, 23),
      exampleLoadedAt: null,
    });
  });
});
