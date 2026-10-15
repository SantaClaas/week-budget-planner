import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { readActivityForm } from "./activity-form";
import { sumPlacedByActivity, splitProgress, summarize, calculateWeeklyBudget } from "./budget";
import { pickDefaultLength, pickDefaultLook, fitToDayHours, hashFnv1a32 } from "./defaults";
import { layoutLanes } from "./lanes";
import { sanitizePlan } from "./sanitize";
import { findFirstFreeSlot, isFree, findOpeningMinute } from "./slots";
import { snapDown, formatClock, formatLength, formatShort, snap } from "./time";
import { DEFAULT_SHAPES, SHAPES, type Activity, type Block } from "./types";
import {
  splitIntoParts,
  isBlockOverlapping,
  sumDayTotals,
  describeTime,
  convertFromWeekMinutes,
  moveBy,
  moveDays,
  moveTo,
  findPartsOnDay,
  resizeEnd,
  resizeStart,
} from "./week";

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  id: "a",
  name: "Work",
  hue: 78,
  shape: "square",
  mode: "week",
  budgetMinutes: 720,
  days: 5,
  ...overrides,
});

const block = (overrides: Partial<Block> = {}): Block => ({
  id: "b",
  activityId: "a",
  day: 0,
  start: 600,
  length: 90,
  ...overrides,
});

describe("time", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(52)).toBe(45);
    expect(snap(53)).toBe(60);
    expect(snapDown(59)).toBe(45);
  });

  it("formats lengths and clock times", () => {
    expect(formatLength(90)).toBe("1 h 30 min");
    expect(formatLength(45)).toBe("45 min");
    expect(formatLength(180)).toBe("3 h");
    expect(formatLength(-30)).toBe("30 min");
    expect(formatShort(90)).toBe("1h30");
    expect(formatShort(65)).toBe("1h05");
    expect(formatShort(30)).toBe("30m");
    expect(formatClock(450)).toBe("07:30");
    expect(formatClock(1500)).toBe("01:00");
  });
});

describe("budget", () => {
  it("counts per-day budgets times their days", () => {
    expect(calculateWeeklyBudget(activity({ mode: "day", budgetMinutes: 90, days: 3 }))).toBe(270);
    expect(calculateWeeklyBudget(activity({ mode: "week", budgetMinutes: 720 }))).toBe(720);
  });

  it("sums placed time and over budget", () => {
    const work = activity();
    const gym = activity({ id: "g", mode: "day", budgetMinutes: 90, days: 3 });
    const blocks = [
      block({ id: "1", length: 750 }),
      block({ id: "2", activityId: "g", length: 90 }),
    ];
    expect(sumPlacedByActivity(blocks).get("a")).toBe(750);
    expect(summarize({ activities: [work, gym], blocks })).toEqual({
      budget: 990,
      placed: 840,
      leftToPlace: 180,
      overBudget: 30,
    });
  });

  it("splits the progress bar at the budget when over", () => {
    expect(splitProgress(720, 360)).toEqual({ withinBudget: 0.5, overBudget: 0 });
    expect(splitProgress(720, 720)).toEqual({ withinBudget: 1, overBudget: 0 });
    const overBudget = splitProgress(720, 750);
    expect(overBudget.withinBudget).toBeCloseTo(0.96);
    expect(overBudget.overBudget).toBeCloseTo(0.04);
  });
});

describe("week", () => {
  it("splits an overnight block into two parts", () => {
    const night = block({ day: 1, start: 1320, length: 240 });
    expect(splitIntoParts(night).map(({ day, start, end, kind }) => ({ day, start, end, kind }))).toEqual([
      { day: 1, start: 1320, end: 1440, kind: "first" },
      { day: 2, start: 0, end: 120, kind: "second" },
    ]);
  });

  it("wraps Sunday night into Monday", () => {
    const sunday = block({ day: 6, start: 1380, length: 120 });
    expect(splitIntoParts(sunday)[1]).toMatchObject({ day: 0, start: 0, end: 60 });
    expect(findPartsOnDay([sunday], 0)).toHaveLength(1);
  });

  it("counts day totals per day, splitting overnight blocks", () => {
    const totals = sumDayTotals([block({ day: 1, start: 1320, length: 240 }), block({ id: "c", day: 1 })]);
    expect(totals).toEqual([0, 120 + 90, 120, 0, 0, 0, 0]);
  });

  it("detects overlaps across midnight and across the week's wrap", () => {
    const sunday = block({ id: "s", day: 6, start: 1380, length: 120 });
    const monday = block({ id: "m", day: 0, start: 30, length: 60 });
    const later = block({ id: "l", day: 0, start: 60, length: 60 });
    expect(isBlockOverlapping(sunday, monday)).toBe(true);
    expect(isBlockOverlapping(sunday, later)).toBe(false);
  });

  it("moves keeping the length, overflowing into the next day", () => {
    const moved = moveTo(block({ length: 240 }), 1, 1320);
    expect(moved).toMatchObject({ day: 1, start: 1320, length: 240 });
    expect(describeTime(moved)).toBe("Tue 22:00 – Wed 02:00 · 4h");
    expect(moveTo(block(), 7, 1500)).toMatchObject({ day: 0, start: 1425 });
  });

  it("moves by minutes across midnight and the week", () => {
    expect(moveBy(block({ day: 0, start: 0 }), -15)).toMatchObject({ day: 6, start: 1425 });
    expect(moveBy(block({ day: 2, start: 1425 }), 15)).toMatchObject({ day: 3, start: 0 });
    expect(moveDays(block({ day: 6 }), 1).day).toBe(0);
    expect(convertFromWeekMinutes(-15)).toEqual({ day: 6, start: 1425 });
  });

  it("resizes from the top keeping the end, within limits", () => {
    expect(resizeStart(block({ start: 600, length: 90 }), 540)).toMatchObject({ start: 540, length: 150 });
    expect(resizeStart(block({ start: 600, length: 90 }), 690)).toMatchObject({ start: 675, length: 15 });
    // The top edge never leaves the block's own day.
    expect(resizeStart(block({ start: 1320, length: 240 }), 1500)).toMatchObject({ start: 1425, length: 135 });
  });

  it("resizes from the bottom without crossing into another day", () => {
    expect(resizeEnd(block({ start: 600, length: 90 }), 2000)).toMatchObject({ length: 840 });
    expect(resizeEnd(block({ start: 600, length: 90 }), 600)).toMatchObject({ length: 15 });
    // An overnight block's second part can shrink to midnight, not below.
    const night = block({ start: 1320, length: 240 });
    expect(resizeEnd(night, 1200)).toMatchObject({ length: 120 });
    expect(resizeEnd(night, 3000)).toMatchObject({ length: 1440 });
  });
});

describe("lanes", () => {
  it("puts overlapping parts side by side and shares the lane count", () => {
    const blocks = [
      block({ id: "a", start: 600, length: 180 }),
      block({ id: "b", start: 660, length: 90 }),
      block({ id: "c", start: 750, length: 60 }),
      block({ id: "d", start: 900, length: 60 }),
    ];
    const lanes = layoutLanes(findPartsOnDay(blocks, 0));
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("slots", () => {
  const plan = { blocks: [] as Block[], dayStart: 7, dayEnd: 22 };

  it("finds the first free slot within the day hours", () => {
    expect(findFirstFreeSlot(plan, activity(), 90)).toEqual({ day: 0, start: 420 });
    const busy = { ...plan, blocks: [block({ start: 420, length: 120 })] };
    expect(findFirstFreeSlot(busy, activity(), 90)).toEqual({ day: 0, start: 540 });
  });

  it("tries days without the activity first for per-day activities", () => {
    const gym = activity({ id: "g", mode: "day", budgetMinutes: 90, days: 3 });
    const busy = { ...plan, blocks: [block({ activityId: "g", day: 0, start: 1080 })] };
    expect(findFirstFreeSlot(busy, gym, 90)).toEqual({ day: 1, start: 420 });
  });

  it("returns nothing when no gap fits", () => {
    expect(findFirstFreeSlot(plan, activity(), 16 * 60)).toBeUndefined();
  });

  it("treats an overnight part as taken", () => {
    const night = block({ day: 0, start: 1320, length: 600 });
    expect(isFree([night], 1, 420, 60)).toBe(false);
    expect(isFree([night], 1, 480, 60)).toBe(true);
  });

  it("opens at the day hours or an earlier block start, ignoring overnight continuations", () => {
    expect(findOpeningMinute({ dayStart: 7, blocks: [] })).toBe(420);
    expect(findOpeningMinute({ dayStart: 7, blocks: [block({ start: 330 })] })).toBe(300);
    expect(findOpeningMinute({ dayStart: 7, blocks: [block({ start: 1320, length: 240 })] })).toBe(420);
  });
});

describe("defaults", () => {
  it("hashes with 32-bit FNV-1a", () => {
    expect(hashFnv1a32("")).toBe(0x811c9dc5);
    expect(hashFnv1a32("a")).toBe(0xe40c292c);
  });

  it("gives the example week the shapes listed in examples/example-week.json", () => {
    const looks: { hue: number; shape: string }[] = [];
    for (const { id, shape } of exampleWeek.activities) {
      const look = pickDefaultLook(id, looks);
      expect(look.shape).toBe(shape);
      looks.push(look);
    }
  });

  it("avoids colors and shapes already in use while any are left", () => {
    const others = DEFAULT_SHAPES.slice(0, 29).map((shape, index) => ({ hue: [255, 28][index % 2]!, shape }));
    const look = pickDefaultLook("anything", others);
    expect(look.shape).toBe(DEFAULT_SHAPES[29]);
    expect([255, 28]).not.toContain(look.hue);
  });

  it("only offers library shapes", () => {
    for (const shape of DEFAULT_SHAPES) expect(SHAPES).toContain(shape);
  });

  it("picks the default length", () => {
    expect(pickDefaultLength(activity(), [])).toBe(90);
    expect(pickDefaultLength(activity({ mode: "day", budgetMinutes: 60, days: 3 }), [])).toBe(60);
    expect(pickDefaultLength(activity({ budgetMinutes: 45 }), [])).toBe(45);
    expect(pickDefaultLength(activity({ budgetMinutes: 120 }), [block({ length: 105 })])).toBe(15);
    // Over budget, the usual length applies.
    expect(pickDefaultLength(activity({ budgetMinutes: 60 }), [block({ length: 90 })])).toBe(90);
  });

  it("caps new blocks at the end of the day hours when they start inside them", () => {
    const hours = { dayStart: 7, dayEnd: 22 };
    expect(fitToDayHours(1260, 90, hours)).toBe(60);
    expect(fitToDayHours(1320, 240, hours)).toBe(240);
    expect(fitToDayHours(600, 90, hours)).toBe(90);
  });
});

describe("sanitize", () => {
  it("keeps the example week as it is", () => {
    const plan = sanitizePlan(exampleWeek);
    expect(plan.activities).toEqual(exampleWeek.activities);
    expect(plan.blocks).toEqual(exampleWeek.blocks);
    expect(plan.exampleLoadedAt).toBeNull();
  });

  it("clamps, snaps, de-duplicates and drops orphaned blocks", () => {
    const plan = sanitizePlan({
      activities: [
        { id: "x", name: "  ", hue: 12, shape: "nope", mode: "day", budgetMinutes: 5000, days: 9 },
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
    });
    const [first, second] = plan.activities;
    expect(first).toMatchObject({ id: "x", name: "Untitled", mode: "day", budgetMinutes: 1440, days: 7 });
    expect(SHAPES).toContain(first!.shape);
    expect(second!.id).not.toBe("x");
    expect(second!.budgetMinutes).toBe(15);
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0]).toMatchObject({ day: 6, start: 1425, length: 1440 });
    expect(plan.blocks[1]).toMatchObject({ day: 2, start: 600, length: 45 });
    expect(plan.blocks[1]!.id).not.toBe("1");
    expect(plan).toMatchObject({ dayStart: 12, dayEnd: 13, exampleLoadedAt: null });
  });

  it("keeps a valid example time, normalized to UTC", () => {
    expect(sanitizePlan({ exampleLoadedAt: "2026-10-15T22:30:00+02:00" }).exampleLoadedAt).toBe(
      "2026-10-15T20:30:00.000Z",
    );
  });

  it("returns an empty plan for anything that isn't a plan", () => {
    expect(sanitizePlan(null).activities).toEqual([]);
    expect(sanitizePlan("text").blocks).toEqual([]);
  });
});

describe("activity form", () => {
  const base = { name: "Gym", hours: "1.5", mode: "week" as const, days: "3" };

  it("accepts valid input and rounds hours to the slot", () => {
    expect(readActivityForm({ ...base, hours: "1,6" })).toEqual({
      ok: true,
      value: { name: "Gym", budgetMinutes: 90, mode: "week", days: 5 },
    });
    expect(readActivityForm({ ...base, mode: "day" })).toMatchObject({ ok: true, value: { days: 3 } });
  });

  it("explains what is wrong", () => {
    expect(readActivityForm({ ...base, name: " " })).toMatchObject({ field: "name" });
    expect(readActivityForm({ ...base, hours: "0" })).toMatchObject({
      message: "Enter the hours it needs, for example 1.5.",
    });
    expect(readActivityForm({ ...base, mode: "day", hours: "25" })).toMatchObject({
      message: "A day has 24 hours. Enter 24 or less.",
    });
    expect(readActivityForm({ ...base, hours: "169" })).toMatchObject({
      message: "A week has 168 hours. Enter 168 or less.",
    });
    expect(readActivityForm({ ...base, mode: "day", days: "8" })).toMatchObject({ field: "days" });
  });
});
