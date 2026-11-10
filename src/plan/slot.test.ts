import { describe, expect, it } from "vitest";

import {
  findEmptySlot,
  findFirstFreeSlot,
  findOpeningMinute,
  isFree,
  moveEmptySlot,
} from "./slot.ts";
import { sanitizeDayIndex, sanitizeDayMinute, sanitizeDayStart, sanitizeLength } from "./time.ts";
import { type Block } from "./block/index.ts";
import { createActivity, createBlock, createDayHours } from "./test-data.ts";

describe("slots", () => {
  const empty: Block[] = [];
  const plan = { blocks: empty, ...createDayHours(7, 22) };

  it("finds the first free slot within the day hours", () => {
    expect(findFirstFreeSlot(plan, createActivity(), sanitizeLength(90))).toEqual({
      day: 0,
      start: 420,
    });
    const busy = { ...plan, blocks: [createBlock({ start: 420, length: 120 })] };
    expect(findFirstFreeSlot(busy, createActivity(), sanitizeLength(90))).toEqual({
      day: 0,
      start: 540,
    });
  });

  it("tries days without the activity first for per-day activities", () => {
    const gym = createActivity({ id: "g", mode: "day", budgetMinutes: 90, days: 3 });
    const busy = { ...plan, blocks: [createBlock({ activityId: "g", day: 0, start: 1080 })] };
    expect(findFirstFreeSlot(busy, gym, sanitizeLength(90))).toEqual({ day: 1, start: 420 });
  });

  it("returns nothing when no gap fits", () => {
    expect(findFirstFreeSlot(plan, createActivity(), sanitizeLength(16 * 60))).toBeUndefined();
  });

  it("treats an overnight part as taken", () => {
    const night = createBlock({ day: 0, start: 1320, length: 600 });
    expect(isFree([night], sanitizeDayIndex(1), sanitizeDayMinute(420), sanitizeLength(60))).toBe(
      false,
    );
    expect(isFree([night], sanitizeDayIndex(1), sanitizeDayMinute(480), sanitizeLength(60))).toBe(
      true,
    );
  });

  it("opens at the day hours or an earlier block start, ignoring overnight continuations", () => {
    expect(findOpeningMinute({ dayStart: sanitizeDayStart(7), blocks: [] })).toBe(420);
    expect(
      findOpeningMinute({ dayStart: sanitizeDayStart(7), blocks: [createBlock({ start: 330 })] }),
    ).toBe(300);
    expect(
      findOpeningMinute({
        dayStart: sanitizeDayStart(7),
        blocks: [createBlock({ start: 1320, length: 240 })],
      }),
    ).toBe(420);
  });
});

/** The slot at `start` minutes into `day`. */
const at = (day: number, start: number) => ({
  day: sanitizeDayIndex(day),
  start: sanitizeDayMinute(start),
});

describe("the empty slot", () => {
  const plan = {
    blocks: [createBlock({ day: 0, start: 420, length: 60 })],
    ...createDayHours(7, 22),
  };

  it("starts at the first empty slot of the day hours", () => {
    expect(findEmptySlot(plan)).toEqual(at(0, 480));
  });

  it("stays where it was while that slot is empty, and moves on once a block covers it", () => {
    expect(findEmptySlot(plan, at(3, 600))).toEqual(at(3, 600));
    expect(findEmptySlot(plan, at(0, 435))).toEqual(at(0, 480));
  });

  it("goes around the week from Sunday night", () => {
    const night = { ...plan, blocks: [createBlock({ day: 6, start: 1425, length: 15 })] };
    expect(findEmptySlot(night, at(6, 1425))).toEqual(at(0, 0));
  });

  it("finds nothing when every slot is covered", () => {
    const full = Array.from({ length: 7 }, (_, day) =>
      createBlock({ day, start: 0, length: 1440 }),
    );
    expect(findEmptySlot({ ...plan, blocks: full })).toBeUndefined();
  });

  it("moves by 15 minutes, an hour or a day, across midnight", () => {
    expect(moveEmptySlot([], at(1, 600), "later")).toEqual(at(1, 615));
    expect(moveEmptySlot([], at(1, 600), "hour-earlier")).toEqual(at(1, 540));
    expect(moveEmptySlot([], at(1, 600), "day-later")).toEqual(at(2, 600));
    expect(moveEmptySlot([], at(1, 0), "earlier")).toEqual(at(0, 1425));
  });

  it("skips the slots that blocks cover", () => {
    expect(moveEmptySlot(plan.blocks, at(0, 405), "later")).toEqual(at(0, 480));
    expect(moveEmptySlot(plan.blocks, at(0, 480), "hour-earlier")).toEqual(at(0, 405));
    expect(moveEmptySlot(plan.blocks, at(1, 420), "day-earlier")).toBeUndefined();
  });

  it("never moves past the week's ends", () => {
    expect(moveEmptySlot([], at(0, 0), "earlier")).toBeUndefined();
    expect(moveEmptySlot([], at(6, 1425), "later")).toBeUndefined();
    expect(moveEmptySlot([], at(6, 600), "day-later")).toBeUndefined();
  });
});
