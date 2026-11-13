import { describe, expect, it } from "vitest";

import { layoutLanes } from "./lane.ts";
import { sanitizeDayIndex } from "./time.ts";
import { findPartsOnDay, splitIntoParts } from "./week.ts";
import { createBlockId, createBlock } from "./test-data.ts";

describe("lanes", () => {
  it("puts overlapping parts side by side and shares the lane count", () => {
    const blocks = [
      createBlock({ id: "a", start: 600, length: 180 }),
      createBlock({ id: "b", start: 660, length: 90 }),
      createBlock({ id: "c", start: 750, length: 60 }),
      createBlock({ id: "d", start: 900, length: 60 }),
    ];
    const lanes = layoutLanes(findPartsOnDay(blocks, sanitizeDayIndex(0)));
    expect(lanes.get(createBlockId("a"))).toEqual({ index: 0, count: 2 });
    expect(lanes.get(createBlockId("b"))).toEqual({ index: 1, count: 2 });
    expect(lanes.get(createBlockId("c"))).toEqual({ index: 1, count: 2 });
    expect(lanes.get(createBlockId("d"))).toEqual({ index: 0, count: 1 });
  });

  it("gives a lane back to a later part once the part in it has ended", () => {
    const blocks = [
      createBlock({ id: "a", start: 600, length: 60 }),
      createBlock({ id: "b", start: 630, length: 90 }),
      createBlock({ id: "c", start: 660, length: 45 }),
    ];
    const lanes = layoutLanes(findPartsOnDay(blocks, sanitizeDayIndex(0)));
    expect(lanes.get(createBlockId("a"))).toEqual({ index: 0, count: 2 });
    expect(lanes.get(createBlockId("b"))).toEqual({ index: 1, count: 2 });
    expect(lanes.get(createBlockId("c"))).toEqual({ index: 0, count: 2 });
  });

  it("starts a new group with a part that begins where the group before it ends", () => {
    const blocks = [
      createBlock({ id: "a", start: 600, length: 120 }),
      createBlock({ id: "b", start: 630, length: 30 }),
      createBlock({ id: "c", start: 720, length: 60 }),
    ];
    const lanes = layoutLanes(findPartsOnDay(blocks, sanitizeDayIndex(0)));
    expect(lanes.get(createBlockId("a"))).toEqual({ index: 0, count: 2 });
    expect(lanes.get(createBlockId("c"))).toEqual({ index: 0, count: 1 });
  });

  it("lays the parts out the same in whatever order they come", () => {
    const later = createBlock({ id: "later", start: 660, length: 60 });
    const short = createBlock({ id: "short", start: 600, length: 30 });
    const long = createBlock({ id: "long", start: 600, length: 90 });
    const lanes = layoutLanes([later, short, long].flatMap((block) => splitIntoParts(block)));
    // Of two parts that start together, the longer one comes first.
    expect(lanes.get(createBlockId("long"))).toEqual({ index: 0, count: 2 });
    expect(lanes.get(createBlockId("short"))).toEqual({ index: 1, count: 2 });
    expect(lanes.get(createBlockId("later"))).toEqual({ index: 1, count: 2 });
  });
});
