import { describe, expect, it } from "vitest";

import { formatHours, parseDecimal, readActivityForm } from "./form.ts";

describe("activity form", () => {
  const base = { name: "Gym", hours: "1.5", mode: "week" as const, days: "3" };

  it("accepts valid input and rounds hours to the slot", () => {
    expect(readActivityForm({ ...base, hours: "1,6" })).toEqual({
      isOk: true,
      value: { name: "Gym", budgetMinutes: 90, mode: "week", days: 5 },
    });
    expect(readActivityForm({ ...base, mode: "day" })).toMatchObject({
      isOk: true,
      value: { days: 3 },
    });
  });

  it("explains what is wrong", () => {
    expect(readActivityForm({ ...base, name: " " })).toMatchObject({
      problems: { name: "Give the activity a name." },
    });
    expect(readActivityForm({ ...base, hours: "0" })).toMatchObject({
      problems: { hours: "Enter the hours it needs, for example 1.5." },
    });
    expect(readActivityForm({ ...base, hours: " " })).toMatchObject({
      problems: { hours: "Enter the hours it needs, for example 1.5." },
    });
    expect(readActivityForm({ ...base, hours: "1.5h" })).toMatchObject({
      problems: { hours: "Enter the hours as a number, for example 1.5." },
    });
    expect(readActivityForm({ ...base, mode: "day", hours: "25" })).toMatchObject({
      problems: { hours: "A day has 24 hours. Enter 24 or less." },
    });
    expect(readActivityForm({ ...base, hours: "169" })).toMatchObject({
      problems: { hours: "A week has 168 hours. Enter 168 or less." },
    });
    expect(readActivityForm({ ...base, mode: "day", days: "8" })).toMatchObject({
      problems: { days: "Enter how many days per week, from 1 to 7." },
    });
    expect(readActivityForm({ ...base, mode: "day", days: "2.5" })).toMatchObject({
      problems: { days: "Enter how many days per week, from 1 to 7." },
    });
  });

  it("says what is wrong with every field at once", () => {
    expect(readActivityForm({ name: "", hours: "x", mode: "day", days: "0" })).toEqual({
      isOk: false,
      problems: {
        name: "Give the activity a name.",
        hours: "Enter the hours as a number, for example 1.5.",
        days: "Enter how many days per week, from 1 to 7.",
      },
    });
    // Per week, the days aren't read.
    expect(readActivityForm({ ...base, days: "0" })).toMatchObject({ isOk: true });
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

  it("shows a budget as hours that read back the same", () => {
    expect(formatHours(90, "en")).toBe("1.5");
    expect(formatHours(90, "de")).toBe("1,5");
    expect(formatHours(4815, "en")).toBe("80.25");
    expect(parseDecimal(formatHours(4815, "de"), "de") * 60).toBe(4815);
  });
});
