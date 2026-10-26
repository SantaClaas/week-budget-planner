import { describe, expect, it } from "vitest";

import { parseDecimal, readActivityForm } from "./activity-form.ts";

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
    expect(readActivityForm({ ...base, hours: " " })).toMatchObject({
      message: "Enter the hours it needs, for example 1.5.",
    });
    expect(readActivityForm({ ...base, hours: "1.5h" })).toMatchObject({
      message: "Enter the hours as a number, for example 1.5.",
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
