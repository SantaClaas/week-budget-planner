import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { sanitizePlan } from "./sanitize.ts";
import { createPredictableIds } from "./test-data.ts";
import { PALETTE, SHAPES } from "./activity/look.ts";

describe("sanitize", () => {
  it("keeps the example week as it is", () => {
    const plan = sanitizePlan(exampleWeek, createPredictableIds());
    expect(plan.activities).toEqual(exampleWeek.activities);
    expect(plan.blocks).toEqual(exampleWeek.blocks);
    expect(plan.exampleLoadedAt).toBeNull();
  });

  it("clamps, snaps, de-duplicates and drops orphaned blocks", () => {
    const plan = sanitizePlan(
      {
        activities: [
          {
            id: "x",
            name: "  ",
            hue: 12,
            shape: "nope",
            mode: "day",
            budgetMinutes: 5000,
            days: 9,
          },
          { id: "x", name: "Copy", mode: "week", budgetMinutes: 7 },
        ],
        blocks: [
          { id: "1", activityId: "x", day: 9, start: 1440, length: 3000 },
          { id: "1", activityId: "x", day: 2, start: 607, length: 52 },
          { id: "2", activityId: "gone", day: 0, start: 0, length: 60 },
        ],
        dayStart: 20,
        dayEnd: 3,
        exampleLoadedAt: "yesterday",
      },
      createPredictableIds(),
    );
    const [first, second] = plan.activities;
    expect(first).toMatchObject({
      id: "x",
      name: "Untitled",
      mode: "day",
      budgetMinutes: 1440,
      days: 7,
    });
    expect(SHAPES).toContain(first?.shape);
    expect(second?.id).not.toBe("x");
    expect(second?.budgetMinutes).toBe(15);
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0]).toMatchObject({ day: 6, start: 1425, length: 1440 });
    expect(plan.blocks[1]).toMatchObject({ day: 2, start: 600, length: 45 });
    expect(plan.blocks[1]?.id).not.toBe("1");
    expect(plan).toMatchObject({ dayStart: 12, dayEnd: 13, exampleLoadedAt: null });
  });

  it("keeps a valid example time, normalized to UTC", () => {
    expect(
      sanitizePlan({ exampleLoadedAt: "2026-10-15T22:30:00+02:00" }, createPredictableIds())
        .exampleLoadedAt,
    ).toBe("2026-10-15T20:30:00Z");
  });

  it("gives invalid and repeated ids new ones, keeping their blocks with the first", () => {
    const plan = sanitizePlan(
      {
        activities: [
          { id: "x".repeat(41), name: "Too long" },
          { id: "keep", name: "Kept" },
          { id: "keep", name: "Repeated" },
        ],
        blocks: [
          { id: "1", activityId: "keep", day: 0, start: 600, length: 60 },
          { id: "2", activityId: "x".repeat(41), day: 0, start: 700, length: 60 },
        ],
      },
      createPredictableIds(),
    );
    expect(plan.activities.map((each) => each.id)).toEqual([
      "new-activity-1",
      "keep",
      "new-activity-2",
    ]);
    // The block of the activity whose id was invalid can't be matched any more and is dropped.
    expect(plan.blocks.map((each) => each.activityId)).toEqual(["keep"]);
  });

  it("returns an empty plan for anything that isn't a plan", () => {
    expect(sanitizePlan(null, createPredictableIds()).activities).toEqual([]);
    expect(sanitizePlan("text", createPredictableIds()).blocks).toEqual([]);
  });

  it("returns empty lists when the activities or the blocks aren't lists", () => {
    const plan = sanitizePlan({ activities: "text", blocks: { id: "1" } }, createPredictableIds());
    expect(plan.activities).toEqual([]);
    expect(plan.blocks).toEqual([]);
  });

  it("skips entries that aren't objects", () => {
    const plan = sanitizePlan(
      {
        activities: [null, "text", 5, { id: "keep", name: "Kept" }],
        blocks: [null, "text", 5, { id: "1", activityId: "keep", day: 0, start: 600, length: 60 }],
      },
      createPredictableIds(),
    );
    expect(plan.activities.map((each) => each.id)).toEqual(["keep"]);
    expect(plan.blocks.map((each) => each.id)).toEqual(["1"]);
  });

  it("reads numbers stored as text, and repairs what isn't a number or text", () => {
    const plan = sanitizePlan(
      {
        activities: [{ id: "a", name: 42 }, { id: 7 }],
        blocks: [
          { id: "1", activityId: "a", day: "2", start: "600", length: "90" },
          { id: "2", activityId: "a", day: true, start: [600], length: null },
        ],
      },
      createPredictableIds(),
    );
    // A name or an id that isn't text counts as missing.
    expect(plan.activities.map((each) => each.name)).toEqual(["Untitled", "Untitled"]);
    expect(plan.activities.map((each) => each.id)).toEqual(["a", "new-activity-1"]);
    expect(plan.blocks[0]).toMatchObject({ day: 2, start: 600, length: 90 });
    // true, a list and null would each convert to a number; they get the fallbacks instead.
    expect(plan.blocks[1]).toMatchObject({ day: 0, start: 540, length: 60 });
  });

  it("keeps every color and shape an activity can have", () => {
    for (const shape of SHAPES) {
      const plan = sanitizePlan({ activities: [{ id: "a", shape }] }, createPredictableIds());
      expect(plan.activities[0]?.shape).toBe(shape);
    }
    for (const { hue } of PALETTE) {
      const plan = sanitizePlan({ activities: [{ id: "a", hue }] }, createPredictableIds());
      expect(plan.activities[0]?.hue).toBe(hue);
    }
  });
});
