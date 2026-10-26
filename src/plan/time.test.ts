import { describe, expect, it } from "vitest";

import {
  parseBudgetMinutes,
  parseDayCount,
  parseDayEnd,
  parseDayStart,
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

describe("strict parsers", () => {
  it("reject what is out of range instead of clamping it", () => {
    expect(parseBudgetMinutes(97, "week")).toBe(90);
    expect(parseBudgetMinutes(0, "week")).toBe("too-small");
    expect(parseBudgetMinutes(-15, "week")).toBe("too-small");
    expect(parseBudgetMinutes(Number.NaN, "day")).toBe("unreadable");
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
