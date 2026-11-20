import { describe, expect, it } from "vitest";

import {
  FIRST_COUNTER,
  LOWEST,
  compare,
  incrementCounter,
  incrementTime,
  parse,
  parseCounter,
  parseNodeId,
  parseTime,
  read,
  sanitizeTime,
} from "./stamp.ts";
import { createStamp } from "./test-data.ts";

/** The time a stamp holds for a wall clock reading `milliseconds` after 1970. */
const at = (milliseconds: number) =>
  sanitizeTime(Temporal.Instant.fromEpochMilliseconds(milliseconds));

/** Each item with the one after it. */
const listNeighbors = <Item>(items: readonly Item[]): [Item, Item][] =>
  items.slice(1).flatMap((later, index): [Item, Item][] => {
    const earlier = items[index];
    return earlier === undefined ? [] : [[earlier, later]];
  });

describe("stamp", () => {
  it("writes the time as 13 digits and the counter as 6, then the node id", () => {
    expect(createStamp(1_763_200_000_000, 3, "K7dq9")).toBe("1763200000000-000003-K7dq9");
    expect(createStamp(42, 0, "a")).toBe("0000000000042-000000-a");
  });

  it("reads back the three parts", () => {
    expect(read(createStamp(1_763_200_000_000, 999_999, "Node7"))).toEqual({
      time: 1_763_200_000_000,
      counter: 999_999,
      node: "Node7",
    });
    expect(read(LOWEST)).toEqual({ time: 0, counter: 0, node: "" });
  });

  it("sorts as text the way it compares: by time, then counter, then node id", () => {
    const ordered = [
      LOWEST,
      createStamp(0, 0, "a"),
      createStamp(9, 999_999, "z"),
      createStamp(10, 0, "a"),
      createStamp(10, 1, "A"),
      createStamp(10, 1, "B"),
      createStamp(10, 1, "Bz"),
      createStamp(10, 1, "a"),
      createStamp(9_999_999_999_999, 999_999, "z"),
    ];
    expect(ordered.toSorted()).toEqual(ordered);
    const neighbors = listNeighbors(ordered);
    expect(neighbors.map(([earlier, later]) => compare(earlier, later))).toEqual(
      neighbors.map(() => -1),
    );
    expect(neighbors.map(([earlier, later]) => compare(later, earlier))).toEqual(
      neighbors.map(() => 1),
    );
    expect(compare(createStamp(5, 5, "a"), createStamp(5, 5, "a"))).toBe(0);
  });

  it("has the lowest stamp below every other", () => {
    expect(LOWEST).toBe("0000000000000-000000-");
    expect(compare(LOWEST, createStamp(0, 0, "0"))).toBeLessThan(0);
  });

  it("holds a wall clock before 1970 or after 2286 at the nearest end", () => {
    expect(at(-5000)).toBe(0);
    expect(at(1_763_200_000_000)).toBe(1_763_200_000_000);
    expect(at(9_999_999_999_999)).toBe(9_999_999_999_999);
    expect(at(10_000_000_000_000)).toBe(9_999_999_999_999);
  });

  it("parses a time and a counter strictly", () => {
    expect(parseTime(0)).toBe(0);
    expect(parseTime(9_999_999_999_999)).toBe(9_999_999_999_999);
    expect(parseTime(-1)).toBe("out-of-range");
    expect(parseTime(10_000_000_000_000)).toBe("out-of-range");
    expect(parseTime(1.5)).toBe("out-of-range");
    expect(parseCounter(999_999)).toBe(999_999);
    expect(parseCounter(1_000_000)).toBe("out-of-range");
    expect(parseCounter(-1)).toBe("out-of-range");
    expect(parseCounter(0.5)).toBe("out-of-range");
  });

  it("counts a counter and a time up to their highest, and no further", () => {
    expect(incrementCounter(FIRST_COUNTER)).toBe(1);
    expect(incrementCounter(read(createStamp(0, 999_999, "a")).counter)).toBe("out-of-range");
    expect(incrementTime(read(createStamp(41, 0, "a")).time)).toBe(42);
    expect(incrementTime(read(createStamp(9_999_999_999_999, 0, "a")).time)).toBe("out-of-range");
  });

  it("parses well-formed stamps and the lowest", () => {
    expect(parse("1763200000000-000003-K7dq9")).toBe("1763200000000-000003-K7dq9");
    expect(parse(`0000000000000-000000-${"x".repeat(40)}`)).toBe(
      `0000000000000-000000-${"x".repeat(40)}`,
    );
    expect(parse(LOWEST)).toBe(LOWEST);
  });

  it.each([
    "176320000000-000003-a",
    "17632000000000-000003-a",
    "1763200000000-00003-a",
    "1763200000000-0000003-a",
    "1763200000000-000003-",
    "0000000000001-000000-",
    "1763200000000-000003-a-b",
    "1763200000000-000003-é",
    `1763200000000-000003-${"x".repeat(41)}`,
    "1763200000000_000003_a",
    " 1763200000000-000003-a",
    "",
    1_763_200_000_000,
    null,
    undefined,
    { toString: () => "1763200000000-000003-a" },
  ])("refuses %j as a stamp", (value) => {
    expect(parse(value)).toBeUndefined();
  });

  it("takes node ids of 1 to 40 ASCII letters and digits", () => {
    expect(parseNodeId("a")).toBe("a");
    expect(parseNodeId("Z9".repeat(20))).toBe("Z9".repeat(20));
  });

  it.each(["", "x".repeat(41), "a-b", "a b", "é", "a_b"])("refuses %j as a node id", (text) => {
    expect(parseNodeId(text)).toBeUndefined();
  });
});
