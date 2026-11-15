import { describe, expect, it } from "vitest";

import { advance, next } from "./clock.ts";
import { LOWEST, compare } from "./stamp.ts";
import { createNodeId, createStamp } from "./test-data.ts";

const node = createNodeId("me");
const at = (milliseconds: number): Temporal.Instant =>
  Temporal.Instant.fromEpochMilliseconds(milliseconds);

describe("clock", () => {
  it("stamps with the wall clock when it's later than the clock", () => {
    expect(next(LOWEST, at(1000), node)).toBe(createStamp(1000, 0, "me"));
    expect(next(createStamp(999, 7, "other"), at(1000), node)).toBe(createStamp(1000, 0, "me"));
  });

  it("counts up within the same millisecond", () => {
    expect(next(createStamp(1000, 0, "me"), at(1000), node)).toBe(createStamp(1000, 1, "me"));
    expect(next(createStamp(1000, 41, "other"), at(1000), node)).toBe(createStamp(1000, 42, "me"));
  });

  it("stays later than a clock that ran ahead of the wall clock", () => {
    const ahead = createStamp(5_000_000, 3, "other");
    expect(next(ahead, at(1000), node)).toBe(createStamp(5_000_000, 4, "me"));
  });

  it("moves the time on by a millisecond instead of passing 999999", () => {
    expect(next(createStamp(1000, 999_998, "me"), at(1000), node)).toBe(
      createStamp(1000, 999_999, "me"),
    );
    expect(next(createStamp(1000, 999_999, "me"), at(1000), node)).toBe(createStamp(1001, 0, "me"));
    expect(next(createStamp(1000, 999_999, "me"), at(500), node)).toBe(createStamp(1001, 0, "me"));
  });

  it("treats a wall clock before 1970 as time zero", () => {
    expect(next(LOWEST, at(-5000), node)).toBe(createStamp(0, 1, "me"));
  });

  it("can't go past the latest time a stamp holds", () => {
    expect(() => next(createStamp(9_999_999_999_999, 999_999, "me"), at(0), node)).toThrow(
      RangeError,
    );
  });

  it("moves on to a later stamp it merged, and keeps its own when that's later", () => {
    const own = createStamp(2000, 0, "me");
    const later = createStamp(3000, 0, "other");
    const earlier = createStamp(1000, 0, "other");
    expect(advance(own, later)).toBe(later);
    expect(advance(own, earlier)).toBe(own);
    expect(advance(own, own)).toBe(own);
  });

  it("stamps after everything it has merged, whatever the wall clock says", () => {
    const merged = advance(createStamp(2000, 0, "me"), createStamp(9_000_000, 5, "other"));
    const stamp = next(merged, at(2001), node);
    expect(compare(stamp, createStamp(9_000_000, 5, "other"))).toBeGreaterThan(0);
  });
});
