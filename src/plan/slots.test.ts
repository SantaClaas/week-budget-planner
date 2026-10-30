import { describe, expect, it } from "vitest";

import { findFirstFreeSlot, isFree, findOpeningMinute } from "./slots.ts";
import { sanitizeDayIndex, sanitizeDayMinute, sanitizeDayStart, sanitizeLength } from "./time.ts";
import { type Block } from "./types.ts";
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
