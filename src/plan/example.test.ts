import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { createExampleWeek, keepExampleWeek, startEmpty } from "./example.ts";
import { randomIds } from "./id.ts";
import type { Plan } from "./index.ts";
import { createDayHours, createPredictableIds } from "./test-data.ts";

const now = Temporal.Instant.from("2026-10-20T08:00:00Z");

const listIds = (plan: Plan): Set<string> =>
  new Set([
    ...plan.activities.values().map((activity) => activity.id),
    ...plan.blocks.values().map((block) => block.id),
  ]);

describe("example week", () => {
  it("is marked as loaded at the moment it was loaded", () => {
    const example = createExampleWeek(now, createPredictableIds());
    expect(example.exampleLoadedAt).toBe("2026-10-20T08:00:00Z");
    expect(example.activities.length).toBeGreaterThan(0);
  });

  it("gets new ids each time it's loaded", () => {
    const first = createExampleWeek(now, randomIds);
    const second = createExampleWeek(now, randomIds);
    const fileIds = new Set([
      ...exampleWeek.activities.values().map((activity) => activity.id),
      ...exampleWeek.blocks.values().map((block) => block.id),
    ]);
    expect(listIds(first).size).toBe(fileIds.size);
    expect(listIds(first).isDisjointFrom(listIds(second))).toBe(true);
    expect(listIds(first).isDisjointFrom(fileIds)).toBe(true);
  });

  it("keeps each block with its activity under the new ids", () => {
    const example = createExampleWeek(now, createPredictableIds());
    const activityNames = new Map(
      example.activities.values().map((activity) => [activity.id, activity.name]),
    );
    const fileNames = new Map(
      exampleWeek.activities.values().map((activity) => [activity.id, activity.name]),
    );
    expect(example.blocks.map((block) => activityNames.get(block.activityId))).toEqual(
      exampleWeek.blocks.map((block) => fileNames.get(block.activityId)),
    );
    expect(example.activities.map((activity) => activity.name)).toEqual(
      exampleWeek.activities.map((activity) => activity.name),
    );
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
