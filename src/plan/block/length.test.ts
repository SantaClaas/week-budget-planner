import { describe, expect, it } from "vitest";

import { createActivity, createBlock, createDayHours } from "../test-data.ts";
import { sanitizeLength } from "../time.ts";
import { fitToDayHours, pickDefaultLength } from "./length.ts";

describe("block length", () => {
  it("picks the default length", () => {
    expect(pickDefaultLength(createActivity(), [])).toBe(90);
    expect(pickDefaultLength(createActivity({ mode: "day", budgetMinutes: 60, days: 3 }), [])).toBe(
      60,
    );
    expect(pickDefaultLength(createActivity({ budgetMinutes: 45 }), [])).toBe(45);
    expect(
      pickDefaultLength(createActivity({ budgetMinutes: 120 }), [createBlock({ length: 105 })]),
    ).toBe(15);
    // Over budget, the usual length applies.
    expect(
      pickDefaultLength(createActivity({ budgetMinutes: 60 }), [createBlock({ length: 90 })]),
    ).toBe(90);
  });

  it("caps new blocks at the end of the day hours when they start inside them", () => {
    const dayHours = createDayHours(7, 22);
    expect(fitToDayHours(1260, sanitizeLength(90), dayHours)).toBe(60);
    expect(fitToDayHours(1320, sanitizeLength(240), dayHours)).toBe(240);
    expect(fitToDayHours(600, sanitizeLength(90), dayHours)).toBe(90);
  });
});
