import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { readActivityForm } from "./activity-form";
import { placedByActivity, progressParts, summarize, target } from "./budget";
import { defaultLength, defaultLook, fitToDayHours, fnv1a32 } from "./defaults";
import { layoutLanes } from "./lanes";
import { sanitizePlan } from "./sanitize";
import { firstFreeSlot, isFree, openingMinute } from "./slots";
import { floorSnap, formatClock, formatLength, formatShort, snap } from "./time";
import { DEFAULT_SHAPES, SHAPES, type Activity, type Block } from "./types";
import {
  blockParts,
  blocksOverlap,
  dayTotals,
  describeTime,
  fromWeekMinutes,
  moveBy,
  moveDays,
  moveTo,
  partsOnDay,
  resizeEnd,
  resizeStart,
} from "./week";

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  id: "a",
  name: "Work",
  hue: 78,
  shape: "square",
  mode: "week",
  mins: 720,
  days: 5,
  ...overrides,
});

const block = (overrides: Partial<Block> = {}): Block => ({
  id: "b",
  act: "a",
  day: 0,
  start: 600,
  dur: 90,
  ...overrides,
});

describe("time", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(52)).toBe(45);
    expect(snap(53)).toBe(60);
    expect(floorSnap(59)).toBe(45);
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
    expect(target(activity({ mode: "day", mins: 90, days: 3 }))).toBe(270);
    expect(target(activity({ mode: "week", mins: 720 }))).toBe(720);
  });

  it("sums placed time and over budget", () => {
    const work = activity();
    const gym = activity({ id: "g", mode: "day", mins: 90, days: 3 });
    const blocks = [
      block({ id: "1", dur: 750 }),
      block({ id: "2", act: "g", dur: 90 }),
    ];
    expect(placedByActivity(blocks).get("a")).toBe(750);
    expect(summarize({ activities: [work, gym], blocks })).toEqual({
      budget: 990,
      placed: 840,
      left: 180,
      over: 30,
    });
  });

  it("splits the progress bar at the budget when over", () => {
    expect(progressParts(720, 360)).toEqual({ within: 0.5, over: 0 });
    expect(progressParts(720, 720)).toEqual({ within: 1, over: 0 });
    const over = progressParts(720, 750);
    expect(over.within).toBeCloseTo(0.96);
    expect(over.over).toBeCloseTo(0.04);
  });
});

describe("week", () => {
  it("splits an overnight block into two parts", () => {
    const night = block({ day: 1, start: 1320, dur: 240 });
    expect(blockParts(night).map(({ day, start, end, kind }) => ({ day, start, end, kind }))).toEqual([
      { day: 1, start: 1320, end: 1440, kind: "first" },
      { day: 2, start: 0, end: 120, kind: "second" },
    ]);
  });

  it("wraps Sunday night into Monday", () => {
    const sunday = block({ day: 6, start: 1380, dur: 120 });
    expect(blockParts(sunday)[1]).toMatchObject({ day: 0, start: 0, end: 60 });
    expect(partsOnDay([sunday], 0)).toHaveLength(1);
  });

  it("counts day totals per day, splitting overnight blocks", () => {
    const totals = dayTotals([block({ day: 1, start: 1320, dur: 240 }), block({ id: "c", day: 1 })]);
    expect(totals).toEqual([0, 120 + 90, 120, 0, 0, 0, 0]);
  });

  it("detects overlaps across midnight and across the week's wrap", () => {
    const sunday = block({ id: "s", day: 6, start: 1380, dur: 120 });
    const monday = block({ id: "m", day: 0, start: 30, dur: 60 });
    const later = block({ id: "l", day: 0, start: 60, dur: 60 });
    expect(blocksOverlap(sunday, monday)).toBe(true);
    expect(blocksOverlap(sunday, later)).toBe(false);
  });

  it("moves keeping the length, overflowing into the next day", () => {
    const moved = moveTo(block({ dur: 240 }), 1, 1320);
    expect(moved).toMatchObject({ day: 1, start: 1320, dur: 240 });
    expect(describeTime(moved)).toBe("Tue 22:00 – Wed 02:00 · 4h");
    expect(moveTo(block(), 7, 1500)).toMatchObject({ day: 0, start: 1425 });
  });

  it("moves by minutes across midnight and the week", () => {
    expect(moveBy(block({ day: 0, start: 0 }), -15)).toMatchObject({ day: 6, start: 1425 });
    expect(moveBy(block({ day: 2, start: 1425 }), 15)).toMatchObject({ day: 3, start: 0 });
    expect(moveDays(block({ day: 6 }), 1).day).toBe(0);
    expect(fromWeekMinutes(-15)).toEqual({ day: 6, start: 1425 });
  });

  it("resizes from the top keeping the end, within limits", () => {
    expect(resizeStart(block({ start: 600, dur: 90 }), 540)).toMatchObject({ start: 540, dur: 150 });
    expect(resizeStart(block({ start: 600, dur: 90 }), 690)).toMatchObject({ start: 675, dur: 15 });
    // The top edge never leaves the block's own day.
    expect(resizeStart(block({ start: 1320, dur: 240 }), 1500)).toMatchObject({ start: 1425, dur: 135 });
  });

  it("resizes from the bottom without crossing into another day", () => {
    expect(resizeEnd(block({ start: 600, dur: 90 }), 2000)).toMatchObject({ dur: 840 });
    expect(resizeEnd(block({ start: 600, dur: 90 }), 600)).toMatchObject({ dur: 15 });
    // An overnight block's second part can shrink to midnight, not below.
    const night = block({ start: 1320, dur: 240 });
    expect(resizeEnd(night, 1200)).toMatchObject({ dur: 120 });
    expect(resizeEnd(night, 3000)).toMatchObject({ dur: 1440 });
  });
});

describe("lanes", () => {
  it("puts overlapping parts side by side and shares the lane count", () => {
    const blocks = [
      block({ id: "a", start: 600, dur: 180 }),
      block({ id: "b", start: 660, dur: 90 }),
      block({ id: "c", start: 750, dur: 60 }),
      block({ id: "d", start: 900, dur: 60 }),
    ];
    const lanes = layoutLanes(partsOnDay(blocks, 0));
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("slots", () => {
  const plan = { blocks: [] as Block[], dayStart: 7, dayEnd: 22 };

  it("finds the first free slot within the day hours", () => {
    expect(firstFreeSlot(plan, activity(), 90)).toEqual({ day: 0, start: 420 });
    const busy = { ...plan, blocks: [block({ start: 420, dur: 120 })] };
    expect(firstFreeSlot(busy, activity(), 90)).toEqual({ day: 0, start: 540 });
  });

  it("tries days without the activity first for per-day activities", () => {
    const gym = activity({ id: "g", mode: "day", mins: 90, days: 3 });
    const busy = { ...plan, blocks: [block({ act: "g", day: 0, start: 1080 })] };
    expect(firstFreeSlot(busy, gym, 90)).toEqual({ day: 1, start: 420 });
  });

  it("returns nothing when no gap fits", () => {
    expect(firstFreeSlot(plan, activity(), 16 * 60)).toBeUndefined();
  });

  it("treats an overnight part as taken", () => {
    const night = block({ day: 0, start: 1320, dur: 600 });
    expect(isFree([night], 1, 420, 60)).toBe(false);
    expect(isFree([night], 1, 480, 60)).toBe(true);
  });

  it("opens at the day hours or an earlier block start, ignoring overnight continuations", () => {
    expect(openingMinute({ dayStart: 7, blocks: [] })).toBe(420);
    expect(openingMinute({ dayStart: 7, blocks: [block({ start: 330 })] })).toBe(300);
    expect(openingMinute({ dayStart: 7, blocks: [block({ start: 1320, dur: 240 })] })).toBe(420);
  });
});

describe("defaults", () => {
  it("hashes with 32-bit FNV-1a", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });

  it("gives the example week the shapes listed in examples/example-week.json", () => {
    const looks: { hue: number; shape: string }[] = [];
    for (const { id, shape } of exampleWeek.activities) {
      const look = defaultLook(id, looks);
      expect(look.shape).toBe(shape);
      looks.push(look);
    }
  });

  it("avoids colors and shapes already in use while any are left", () => {
    const others = DEFAULT_SHAPES.slice(0, 29).map((shape, index) => ({ hue: [255, 28][index % 2]!, shape }));
    const look = defaultLook("anything", others);
    expect(look.shape).toBe(DEFAULT_SHAPES[29]);
    expect([255, 28]).not.toContain(look.hue);
  });

  it("only offers library shapes", () => {
    for (const shape of DEFAULT_SHAPES) expect(SHAPES).toContain(shape);
  });

  it("picks the default length", () => {
    expect(defaultLength(activity(), [])).toBe(90);
    expect(defaultLength(activity({ mode: "day", mins: 60, days: 3 }), [])).toBe(60);
    expect(defaultLength(activity({ mins: 45 }), [])).toBe(45);
    expect(defaultLength(activity({ mins: 120 }), [block({ dur: 105 })])).toBe(15);
    // Over budget, the usual length applies.
    expect(defaultLength(activity({ mins: 60 }), [block({ dur: 90 })])).toBe(90);
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
    expect(plan.example).toBe(true);
  });

  it("clamps, snaps, de-duplicates and drops orphaned blocks", () => {
    const plan = sanitizePlan({
      activities: [
        { id: "x", name: "  ", hue: 12, shape: "nope", mode: "day", mins: 5000, days: 9 },
        { id: "x", name: "Copy", mode: "week", mins: 7 },
      ],
      blocks: [
        { id: "1", act: "x", day: 9, start: 1440, dur: 3000 },
        { id: "1", act: "x", day: 2, start: 607, dur: 52 },
        { id: "2", act: "gone", day: 0, start: 0, dur: 60 },
      ],
      dayStart: 20,
      dayEnd: 3,
      example: "yes",
    });
    const [first, second] = plan.activities;
    expect(first).toMatchObject({ id: "x", name: "Untitled", mode: "day", mins: 1440, days: 7 });
    expect(SHAPES).toContain(first!.shape);
    expect(second!.id).not.toBe("x");
    expect(second!.mins).toBe(15);
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0]).toMatchObject({ day: 6, start: 1425, dur: 1440 });
    expect(plan.blocks[1]).toMatchObject({ day: 2, start: 600, dur: 45 });
    expect(plan.blocks[1]!.id).not.toBe("1");
    expect(plan).toMatchObject({ dayStart: 12, dayEnd: 13, example: false });
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
      value: { name: "Gym", mins: 90, mode: "week", days: 5 },
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
