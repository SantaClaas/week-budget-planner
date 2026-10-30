import { describe, expect, it } from "vitest";

import exampleWeek from "../../../examples/example-week.json";
import {
  DEFAULT_SHAPES,
  SHAPES,
  hashFnv1a32,
  pickDefaultLook,
  type Hue,
  type Shape,
} from "./look.ts";

describe("look", () => {
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
});
