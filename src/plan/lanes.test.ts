import { describe, expect, it } from "vitest";

import { layoutLanes } from "./lanes.ts";
import { sanitizeDayIndex as dayIndex } from "./time.ts";
import { findPartsOnDay } from "./week.ts";
import { blockId, block } from "./test-data.ts";

describe("lanes", () => {
  it("puts overlapping parts side by side and shares the lane count", () => {
    const blocks = [
      block({ id: "a", start: 600, length: 180 }),
      block({ id: "b", start: 660, length: 90 }),
      block({ id: "c", start: 750, length: 60 }),
      block({ id: "d", start: 900, length: 60 }),
    ];
    const lanes = layoutLanes(findPartsOnDay(blocks, dayIndex(0)));
    expect(lanes.get(blockId("a"))).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(blockId("b"))).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(blockId("c"))).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(blockId("d"))).toEqual({ lane: 0, lanes: 1 });
  });
});
