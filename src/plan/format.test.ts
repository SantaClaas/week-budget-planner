import { describe, expect, it } from "vitest";

import {
  formatClock,
  formatClockDatetime,
  formatClockRange,
  formatClockRangeToParts,
  formatLength,
  formatLengthDatetime,
  formatWeekday,
} from "./format.ts";

describe("format", () => {
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

  it("spells lengths out for screen readers", () => {
    expect(formatLength(90, "long", { locale: "en-GB" })).toBe("1 hour, 30 minutes");
    expect(formatLength(240, "long", { locale: "en-GB" })).toBe("4 hours");
  });

  it("splits a range into its start, its end and what's between", () => {
    expect(formatClockRangeToParts(600, 690, { locale: "en-GB" })).toEqual([
      { text: "10:00", source: "startRange" },
      { text: "–", source: "shared" },
      { text: "11:30", source: "endRange" },
    ]);
    const american = formatClockRangeToParts(600, 690, { locale: "en-US" });
    expect(american.map(({ source }) => source)).toEqual([
      "startRange",
      "shared",
      "endRange",
      "shared",
    ]);
  });

  it("writes HTML's datetime values for clock times and lengths", () => {
    expect(formatClockDatetime(630)).toBe("10:30");
    expect(formatClockDatetime(1500)).toBe("01:00");
    expect(formatLengthDatetime(90)).toBe("PT1H30M");
    expect(formatLengthDatetime(1440)).toBe("PT24H");
  });
});
