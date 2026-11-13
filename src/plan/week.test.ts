import { describe, expect, it } from "vitest";

import { sanitizeDayIndex } from "./time.ts";
import {
  splitIntoParts,
  isBlockOverlapping,
  sumDayTotals,
  changeLength,
  describeTime,
  convertFromWeekMinutes,
  moveBy,
  moveDays,
  moveTo,
  findPartsOnDay,
  resizeEnd,
  resizeStart,
} from "./week.ts";
import { createBlock } from "./test-data.ts";

describe("week", () => {
  it("splits an overnight block into two parts", () => {
    const night = createBlock({ day: 1, start: 1320, length: 240 });
    expect(
      splitIntoParts(night).map(({ day, start, end, kind }) => ({ day, start, end, kind })),
    ).toEqual([
      { day: 1, start: 1320, end: 1440, kind: "first" },
      { day: 2, start: 0, end: 120, kind: "second" },
    ]);
  });

  it("wraps Sunday night into Monday", () => {
    const sunday = createBlock({ day: 6, start: 1380, length: 120 });
    expect(splitIntoParts(sunday)[1]).toMatchObject({ day: 0, start: 0, end: 60 });
    expect(findPartsOnDay([sunday], sanitizeDayIndex(0))).toHaveLength(1);
  });

  it("counts day totals per day, splitting overnight blocks", () => {
    const totals = sumDayTotals([
      createBlock({ day: 1, start: 1320, length: 240 }),
      createBlock({ id: "c", day: 1 }),
    ]);
    expect(totals).toEqual([0, 120 + 90, 120, 0, 0, 0, 0]);
  });

  it("detects overlaps across midnight and across the week's wrap", () => {
    const sunday = createBlock({ id: "s", day: 6, start: 1380, length: 120 });
    const monday = createBlock({ id: "m", day: 0, start: 30, length: 60 });
    const later = createBlock({ id: "l", day: 0, start: 60, length: 60 });
    expect(isBlockOverlapping(sunday, monday)).toBe(true);
    expect(isBlockOverlapping(sunday, later)).toBe(false);
  });

  it("moves keeping the length, overflowing into the next day", () => {
    const moved = moveTo(createBlock({ length: 240 }), 1, 1320);
    expect(moved).toMatchObject({ day: 1, start: 1320, length: 240 });
    expect(describeTime(moved, { locale: "en-GB" })).toBe("Tue 22:00 – Wed 02:00 · 4h");
    expect(moveTo(createBlock(), 7, 1500)).toMatchObject({ day: 0, start: 1425 });
  });

  it("moves by minutes across midnight and the week", () => {
    expect(moveBy(createBlock({ day: 0, start: 0 }), -15)).toMatchObject({ day: 6, start: 1425 });
    expect(moveBy(createBlock({ day: 2, start: 1425 }), 15)).toMatchObject({ day: 3, start: 0 });
    expect(moveDays(createBlock({ day: 6 }), 1).day).toBe(0);
    expect(convertFromWeekMinutes(-15)).toEqual({ day: 6, start: 1425 });
  });

  it("resizes from the top keeping the end, within limits", () => {
    expect(resizeStart(createBlock({ start: 600, length: 90 }), 540)).toMatchObject({
      start: 540,
      length: 150,
    });
    expect(resizeStart(createBlock({ start: 600, length: 90 }), 690)).toMatchObject({
      start: 675,
      length: 15,
    });
    // The top edge never leaves the block's own day.
    expect(resizeStart(createBlock({ start: 1320, length: 240 }), 1500)).toMatchObject({
      start: 1425,
      length: 135,
    });
  });

  it("resizes from the bottom without crossing into another day", () => {
    expect(resizeEnd(createBlock({ start: 600, length: 90 }), 2000)).toMatchObject({ length: 840 });
    expect(resizeEnd(createBlock({ start: 600, length: 90 }), 600)).toMatchObject({ length: 15 });
    // An overnight block's second part can shrink to midnight, not below.
    const night = createBlock({ start: 1320, length: 240 });
    expect(resizeEnd(night, 1200)).toMatchObject({ length: 120 });
    expect(resizeEnd(night, 3000)).toMatchObject({ length: 1440 });
  });
  it("changes the length from the keyboard, across midnight", () => {
    expect(changeLength(createBlock({ start: 1380, length: 60 }), 15)).toMatchObject({
      start: 1380,
      length: 75,
    });
    expect(changeLength(createBlock({ length: 15 }), -15)).toMatchObject({ length: 15 });
    expect(changeLength(createBlock({ length: 1440 }), 15)).toMatchObject({ length: 1440 });
  });

  it("keeps a block that ends at midnight a one-day block", () => {
    const untilMidnight = createBlock({ day: 1, start: 1380, length: 60 });
    expect(
      splitIntoParts(untilMidnight).map(({ day, start, end, kind }) => ({ day, start, end, kind })),
    ).toEqual([{ day: 1, start: 1380, end: 1440, kind: "only" }]);
    expect(describeTime(untilMidnight, { locale: "en-GB" })).toBe("23:00–00:00 · 1h");
    // Its bottom edge stops at midnight, and can come back up to a slot below the start.
    expect(resizeEnd(untilMidnight, 1500)).toMatchObject({ length: 60 });
    expect(resizeEnd(untilMidnight, 1300)).toMatchObject({ length: 15 });
  });

  it("detects an overlap across the week's wrap whichever block comes first", () => {
    const sunday = createBlock({ id: "s", day: 6, start: 1380, length: 120 });
    const monday = createBlock({ id: "m", day: 0, start: 30, length: 60 });
    expect(isBlockOverlapping(monday, sunday)).toBe(true);
    // Blocks that only touch don't overlap.
    const afterwards = createBlock({ id: "a", day: 0, start: 60, length: 60 });
    expect(isBlockOverlapping(afterwards, sunday)).toBe(false);
  });

  it("sorts a day's parts by start, the longer one first when they start together", () => {
    const parts = findPartsOnDay(
      [
        createBlock({ id: "later", start: 660, length: 60 }),
        createBlock({ id: "short", start: 600, length: 30 }),
        createBlock({ id: "long", start: 600, length: 90 }),
      ],
      sanitizeDayIndex(0),
    );
    expect(parts.map((part) => part.block.id)).toEqual(["long", "short", "later"]);
  });

  it("resizes an overnight block from the top to a day at most", () => {
    expect(resizeStart(createBlock({ start: 1320, length: 240 }), 0)).toMatchObject({
      start: 120,
      length: 1440,
    });
  });
});
