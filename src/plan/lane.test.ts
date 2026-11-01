import { describe, expect, it } from "vitest";

import { layoutLanes } from "./lane.ts";
import { sanitizeDayIndex } from "./time.ts";
import { findPartsOnDay } from "./week.ts";
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
});
