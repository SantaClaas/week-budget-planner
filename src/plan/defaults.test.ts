import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { pickDefaultLength, pickDefaultLook, fitToDayHours, hashFnv1a32 } from "./defaults.ts";
import { sanitizeLength as length } from "./time.ts";
import { DEFAULT_SHAPES, SHAPES, type Hue, type Shape } from "./types.ts";
import { activity, block, hours } from "./test-data.ts";

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
