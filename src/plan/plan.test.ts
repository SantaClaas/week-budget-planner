import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { parseDecimal, readActivityForm } from "./activity-form.ts";
import { sumPlacedByActivity, splitProgress, summarize, calculateWeeklyBudget } from "./budget.ts";
import { pickDefaultLength, pickDefaultLook, fitToDayHours, hashFnv1a32 } from "./defaults.ts";
import { layoutLanes } from "./lanes.ts";
import { findFirstFreeSlot, isFree, findOpeningMinute } from "./slots.ts";
import { formatClock, formatClockRange, formatLength, formatWeekday } from "./format.ts";
import {
  createActivityId,
  createBlockId,
  sanitizeActivityId,
  sanitizeBlockId,
  type ActivityId,
  type BlockId,
} from "./id.ts";
import { sanitizePlan } from "./sanitize.ts";
import {
  parseBudgetMinutes,
  parseDayCount,
  parseDayEnd,
  parseDayStart,
  sanitizeBudgetMinutes,
  sanitizeDayCount,
  sanitizeDayEnd,
  sanitizeDayIndex as dayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength as length,
  snapDown,
  snap,
} from "./time.ts";
import { DEFAULT_SHAPES, SHAPES, type Activity, type Block, type Hue, type Shape } from "./types.ts";
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
} from "./week.ts";

// Tests write plain numbers and strings. These turn them into checked values through the same
// sanitizers the app uses, which also keeps the test data valid.
function required<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`The test data has an invalid ${what}.`);
  return value;
}
const activityId = (id: string): ActivityId => required(sanitizeActivityId(id), "activity id");
const blockId = (id: string): BlockId => required(sanitizeBlockId(id), "block id");

type ActivityValues = {
  id?: string;
  name?: string;
  hue?: Hue;
  shape?: Shape;
  mode?: Activity["mode"];
  budgetMinutes?: number;
  days?: number;
};
const activity = ({
  id = "a",
  mode = "week",
  budgetMinutes = 720,
  days = 5,
  ...rest
}: ActivityValues = {}): Activity => ({
  name: "Work",
  hue: 78,
  shape: "square",
  ...rest,
  id: activityId(id),
  mode,
  budgetMinutes: sanitizeBudgetMinutes(budgetMinutes, mode),
  days: sanitizeDayCount(days),
});

type BlockValues = {
  id?: string;
  activityId?: string;
  day?: number;
  start?: number;
  length?: number;
};
const block = (values: BlockValues = {}): Block => ({
  id: blockId(values.id ?? "b"),
  activityId: activityId(values.activityId ?? "a"),
  day: dayIndex(values.day ?? 0),
  start: sanitizeDayMinute(values.start ?? 600),
  length: length(values.length ?? 90),
});

const hours = (dayStart: number, dayEnd: number) => ({
  dayStart: sanitizeDayStart(dayStart),
  dayEnd: sanitizeDayEnd(dayEnd),
});

describe("time", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(52)).toBe(45);
    expect(snap(53)).toBe(60);
    expect(snapDown(59)).toBe(45);
  });

  it("formats lengths with Intl", () => {
    const british = { locale: "en-GB" };
    const american = { locale: "en-US" };
    expect(formatLength(90, "short", american)).toBe("1 hr, 30 min");
    expect(formatLength(45, "short", american)).toBe("45 min");
    expect(formatLength(180, "short", american)).toBe("3 hr");
    expect(formatLength(-30, "short", american)).toBe("30 min");
    expect(formatLength(0, "short", american)).toBe("0 min");
    expect(formatLength(90, "short", british)).toBe("1 hr, 30 mins");
    expect(formatLength(90, "narrow", british)).toBe("1h 30m");
    expect(formatLength(65, "narrow", british)).toBe("1h 5m");
    expect(formatLength(30, "narrow", british)).toBe("30m");
    expect(formatLength(1440, "narrow", british)).toBe("24h");
    expect(formatLength(90, "short", { locale: "de" })).toBe("1 Std., 30 Min.");
  });

  it("formats clock times and weekdays with Intl", () => {
    expect(formatClock(450, { locale: "en-GB" })).toBe("07:30");
    expect(formatClock(1500, { locale: "en-GB" })).toBe("01:00");
    expect(formatClock(450, { locale: "en-US" })).toBe("7:30 AM");
    expect(formatClock(450, { locale: "en-US", hourCycle: "h23" })).toBe("07:30");
    expect(formatClock(1080, { locale: "en-GB", hourCycle: "h12" })).toBe("6:00 pm");
    expect(formatClock(450, { locale: "de", hourCycle: "h23" })).toBe("07:30");
    expect(formatClockRange(600, 690, { locale: "en-GB" })).toBe("10:00–11:30");
    // Which spaces go around the dash and before AM changes between ICU versions (thin, narrow
    // no-break or plain), so this compares them all as plain spaces.
    expect(formatClockRange(600, 690, { locale: "en-US" }).replaceAll(/\s/gu, " ")).toBe(
      "10:00 – 11:30 AM",
    );
    expect(formatWeekday(0, "short", { locale: "en-GB" })).toBe("Mon");
    expect(formatWeekday(6, "long", { locale: "de" })).toBe("Sonntag");
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
    expect(sumPlacedByActivity(blocks).get(activityId("a"))).toBe(750);
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
    expect(
      splitIntoParts(night).map(({ day, start, end, kind }) => ({ day, start, end, kind })),
    ).toEqual([
      { day: 1, start: 1320, end: 1440, kind: "first" },
      { day: 2, start: 0, end: 120, kind: "second" },
    ]);
  });

  it("wraps Sunday night into Monday", () => {
    const sunday = block({ day: 6, start: 1380, length: 120 });
    expect(splitIntoParts(sunday)[1]).toMatchObject({ day: 0, start: 0, end: 60 });
    expect(findPartsOnDay([sunday], dayIndex(0))).toHaveLength(1);
  });

  it("counts day totals per day, splitting overnight blocks", () => {
    const totals = sumDayTotals([
      block({ day: 1, start: 1320, length: 240 }),
      block({ id: "c", day: 1 }),
    ]);
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
    expect(describeTime(moved, { locale: "en-GB" })).toBe("Tue 22:00 – Wed 02:00 · 4h");
    expect(moveTo(block(), 7, 1500)).toMatchObject({ day: 0, start: 1425 });
  });

  it("moves by minutes across midnight and the week", () => {
    expect(moveBy(block({ day: 0, start: 0 }), -15)).toMatchObject({ day: 6, start: 1425 });
    expect(moveBy(block({ day: 2, start: 1425 }), 15)).toMatchObject({ day: 3, start: 0 });
    expect(moveDays(block({ day: 6 }), 1).day).toBe(0);
    expect(convertFromWeekMinutes(-15)).toEqual({ day: 6, start: 1425 });
  });

  it("resizes from the top keeping the end, within limits", () => {
    expect(resizeStart(block({ start: 600, length: 90 }), 540)).toMatchObject({
      start: 540,
      length: 150,
    });
    expect(resizeStart(block({ start: 600, length: 90 }), 690)).toMatchObject({
      start: 675,
      length: 15,
    });
    // The top edge never leaves the block's own day.
    expect(resizeStart(block({ start: 1320, length: 240 }), 1500)).toMatchObject({
      start: 1425,
      length: 135,
    });
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
    const lanes = layoutLanes(findPartsOnDay(blocks, dayIndex(0)));
    expect(lanes.get(blockId("a"))).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(blockId("b"))).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(blockId("c"))).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(blockId("d"))).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("slots", () => {
  const empty: Block[] = [];
  const plan = { blocks: empty, ...hours(7, 22) };

  it("finds the first free slot within the day hours", () => {
    expect(findFirstFreeSlot(plan, activity(), length(90))).toEqual({ day: 0, start: 420 });
    const busy = { ...plan, blocks: [block({ start: 420, length: 120 })] };
    expect(findFirstFreeSlot(busy, activity(), length(90))).toEqual({ day: 0, start: 540 });
  });

  it("tries days without the activity first for per-day activities", () => {
    const gym = activity({ id: "g", mode: "day", budgetMinutes: 90, days: 3 });
    const busy = { ...plan, blocks: [block({ activityId: "g", day: 0, start: 1080 })] };
    expect(findFirstFreeSlot(busy, gym, length(90))).toEqual({ day: 1, start: 420 });
  });

  it("returns nothing when no gap fits", () => {
    expect(findFirstFreeSlot(plan, activity(), length(16 * 60))).toBeUndefined();
  });

  it("treats an overnight part as taken", () => {
    const night = block({ day: 0, start: 1320, length: 600 });
    expect(isFree([night], dayIndex(1), sanitizeDayMinute(420), length(60))).toBe(false);
    expect(isFree([night], dayIndex(1), sanitizeDayMinute(480), length(60))).toBe(true);
  });

  it("opens at the day hours or an earlier block start, ignoring overnight continuations", () => {
    expect(findOpeningMinute({ dayStart: sanitizeDayStart(7), blocks: [] })).toBe(420);
    expect(
      findOpeningMinute({ dayStart: sanitizeDayStart(7), blocks: [block({ start: 330 })] }),
    ).toBe(300);
    expect(
      findOpeningMinute({
        dayStart: sanitizeDayStart(7),
        blocks: [block({ start: 1320, length: 240 })],
      }),
    ).toBe(420);
  });
});

describe("defaults", () => {
  it("hashes with 32-bit FNV-1a", () => {
    expect(hashFnv1a32("")).toBe(0x811c9dc5);
    expect(hashFnv1a32("a")).toBe(0xe40c292c);
  });

  it("gives the example week the shapes listed in examples/example-week.json", () => {
    const looks: { hue: Hue; shape: Shape }[] = [];
    for (const { id, shape } of exampleWeek.activities) {
      const look = pickDefaultLook(id, looks);
      expect(look.shape).toBe(shape);
      looks.push(look);
    }
  });

  it("avoids colors and shapes already in use while any are left", () => {
    const blue: Hue = 255;
    const red: Hue = 28;
    const others = [
      ...DEFAULT_SHAPES.slice(0, 15).map((shape) => ({ hue: blue, shape })),
      ...DEFAULT_SHAPES.slice(15, 29).map((shape) => ({ hue: red, shape })),
    ];
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
    const dayHours = hours(7, 22);
    expect(fitToDayHours(1260, length(90), dayHours)).toBe(60);
    expect(fitToDayHours(1320, length(240), dayHours)).toBe(240);
    expect(fitToDayHours(600, length(90), dayHours)).toBe(90);
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
    expect(sanitizePlan({ exampleLoadedAt: "2026-10-15T22:30:00+02:00" }).exampleLoadedAt).toBe(
      "2026-10-15T20:30:00Z",
    );
  });

  it("creates 12-character ids without lookalike characters", () => {
    const ids = [
      ...Array.from({ length: 100 }, createActivityId),
      ...Array.from({ length: 100 }, createBlockId),
    ];
    for (const id of ids) expect(id).toMatch(/^[6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz]{12}$/u);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives invalid and repeated ids new ones, keeping their blocks with the first", () => {
    const plan = sanitizePlan({
      activities: [
        { id: "x".repeat(41), name: "Too long" },
        { id: "keep", name: "Kept" },
        { id: "keep", name: "Repeated" },
      ],
      blocks: [
        { id: "1", activityId: "keep", day: 0, start: 600, length: 60 },
        { id: "2", activityId: "x".repeat(41), day: 0, start: 700, length: 60 },
      ],
    });
    expect(plan.activities.map((each) => each.id)).toEqual([
      expect.not.stringMatching(/^x+$/u),
      "keep",
      expect.not.stringMatching(/^keep$/u),
    ]);
    // The block of the activity whose id was invalid can't be matched any more and is dropped.
    expect(plan.blocks.map((each) => each.activityId)).toEqual(["keep"]);
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
    expect(readActivityForm({ ...base, mode: "day" })).toMatchObject({
      ok: true,
      value: { days: 3 },
    });
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
    expect(readActivityForm({ ...base, mode: "day", days: "2.5" })).toMatchObject({
      field: "days",
    });
    expect(readActivityForm({ ...base, hours: "1.5h" })).toMatchObject({ field: "hours" });
  });

  it("reads hours with the language's decimal separator, strictly", () => {
    expect(parseDecimal("1.5")).toBe(1.5);
    expect(parseDecimal(" 1,5 ")).toBe(1.5);
    expect(parseDecimal("1,5", "de")).toBe(1.5);
    expect(parseDecimal(".5")).toBe(0.5);
    expect(parseDecimal("1.5h")).toBeNaN();
    expect(parseDecimal("1.2.3")).toBeNaN();
    expect(parseDecimal("-1")).toBeNaN();
    expect(parseDecimal("")).toBeNaN();
  });
});

describe("strict parsers", () => {
  it("reject what is out of range instead of clamping it", () => {
    expect(parseBudgetMinutes(97, "week")).toBe(90);
    expect(parseBudgetMinutes(0, "week")).toBe("too-small");
    expect(parseBudgetMinutes(Number.NaN, "day")).toBe("too-small");
    expect(parseBudgetMinutes(1441, "day")).toBe("too-large");
    expect(parseBudgetMinutes(1441, "week")).toBe(1440);
    expect(parseDayCount(7)).toBe(7);
    expect(parseDayCount(0)).toBeUndefined();
    expect(parseDayCount(2.5)).toBeUndefined();
    expect(parseDayStart(12)).toBe(12);
    expect(parseDayStart(13)).toBeUndefined();
    expect(parseDayEnd(24)).toBe(24);
    expect(parseDayEnd(12)).toBeUndefined();
  });
});
