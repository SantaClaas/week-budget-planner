import { describe, expect, it } from "vitest";

import {
  parseBudgetMinutes,
  parseDayCount,
  parseDayEnd,
  parseDayStart,
  sanitizeBudgetMinutes,
  sanitizePlaced,
  sanitizeTotalBudget,
  sanitizeWeeklyBudget,
  snapDown,
  snap,
} from "./time.ts";

describe("time", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(52)).toBe(45);
    expect(snap(53)).toBe(60);
    expect(snapDown(59)).toBe(45);
  });
});

describe("weekly budgets", () => {
  it("keeps an activity's weekly budget a multiple of the slot from a slot to a week", () => {
    expect(sanitizeWeeklyBudget(270)).toBe(270);
    expect(sanitizeWeeklyBudget(97)).toBe(90);
    expect(sanitizeWeeklyBudget(0)).toBe(15);
    expect(sanitizeWeeklyBudget(10_080)).toBe(10_080);
    expect(sanitizeWeeklyBudget(20_160)).toBe(10_080);
    expect(sanitizeWeeklyBudget(Number.NaN)).toBe(60);
  });
});

describe("totals", () => {
  it.each([
    ["a total budget", sanitizeTotalBudget],
    ["placed time", sanitizePlaced],
  ])("keeps %s a multiple of the slot from 0 up, with no upper limit", (_, sanitize) => {
    expect(sanitize(270)).toBe(270);
    expect(sanitize(97)).toBe(90);
    expect(sanitize(0)).toBe(0);
    // more than a week fits: the week's budget can ask for more than there is
    expect(sanitize(20_160)).toBe(20_160);
  });

  it.each([
    ["a total budget", sanitizeTotalBudget],
    ["placed time", sanitizePlaced],
  ])("repairs %s that is below 0 or not finite to 0", (_, sanitize) => {
    expect(sanitize(-15)).toBe(0);
    expect(sanitize(Number.NaN)).toBe(0);
    expect(sanitize(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("strict parsers", () => {
  it("reject what is out of range instead of clamping it", () => {
    expect(parseBudgetMinutes(97, "week")).toBe(90);
    expect(parseBudgetMinutes(0, "week")).toBe("too-small");
    expect(parseBudgetMinutes(-15, "week")).toBe("too-small");
    expect(parseBudgetMinutes(Number.NaN, "day")).toBe("unreadable");
    expect(parseBudgetMinutes(1441, "day")).toBe("too-large");
    expect(parseBudgetMinutes(1441, "week")).toBe(1440);
    expect(parseDayCount(7)).toBe(7);
    expect(parseDayCount(0)).toBe("out-of-range");
    expect(parseDayCount(2.5)).toBe("out-of-range");
    expect(parseDayStart(12)).toBe(12);
    expect(parseDayStart(13)).toBe("out-of-range");
    expect(parseDayEnd(24)).toBe(24);
    expect(parseDayEnd(12)).toBe("out-of-range");
  });

  it("accept the values exactly at a limit", () => {
    expect(parseBudgetMinutes(1440, "day")).toBe(1440);
    expect(parseBudgetMinutes(10_080, "week")).toBe(10_080);
    expect(parseBudgetMinutes(10_081, "week")).toBe("too-large");
    expect(parseDayCount(1)).toBe(1);
    expect(parseDayCount(8)).toBe("out-of-range");
    expect(parseDayStart(0)).toBe(0);
    expect(parseDayEnd(13)).toBe(13);
  });
});

describe("budgets", () => {
  it("caps a budget per day at a day and a budget per week at a week", () => {
    expect(sanitizeBudgetMinutes(6000, "day")).toBe(1440);
    expect(sanitizeBudgetMinutes(6000, "week")).toBe(6000);
    expect(sanitizeBudgetMinutes(20_160, "week")).toBe(10_080);
  });
});
