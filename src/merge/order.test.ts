import { describe, expect, it } from "vitest";

import { assign, between, compare, parse, spread, type OrderKey } from "./order.ts";

function createKey(text: string): OrderKey {
  const key = parse(text);
  if (key === undefined) throw new Error(`The test data has an invalid order key: ${text}.`);
  return key;
}

/** Whether every key is valid and each sorts strictly after the one before. */
const isAscending = (keys: readonly string[]): boolean =>
  keys.every((key, index) => parse(key) === key && (index === 0 || (keys[index - 1] ?? "") < key));

/** The positions whose keys `assign` changed. */
const listChanged = (before: readonly (OrderKey | undefined)[], after: readonly OrderKey[]) =>
  after.flatMap((key, index) => (key === before[index] ? [] : [index]));

/** Every way to drag one item of `keys` to another place. */
const listMoves = (keys: readonly OrderKey[]): OrderKey[][] =>
  keys.flatMap((moved, from) =>
    keys.flatMap((_, to) => (from === to ? [] : [keys.toSpliced(from, 1).toSpliced(to, 0, moved)])),
  );

/**
 * Makes `count` keys in the same gap, each between the last two: alternately right after the low
 * one and right before the high one, so the gap keeps narrowing from both sides.
 */
function insertIntoGap(count: number): { keys: OrderKey[]; low: OrderKey; high: OrderKey } {
  let low = createKey("V");
  let high = createKey("W");
  const keys = [low, high];
  for (let index = 0; index < count; index += 1) {
    const key = between(low, high);
    keys.push(key);
    if (index % 2 === 0) high = key;
    // oxlint-disable-next-line week-budget-planner/no-else -- two equal branches that take turns read best side by side.
    else low = key;
  }
  return { keys, low, high };
}

/** Makes `count` keys before the first and as many after the last. */
function insertAtEnds(count: number): OrderKey[] {
  let first = between();
  let last = first;
  const keys = [first];
  for (let index = 0; index < count; index += 1) {
    first = between(undefined, first);
    last = between(last);
    keys.unshift(first);
    keys.push(last);
  }
  return keys;
}

/** Drags the last activity between the first two, `count` times: how many keys each move changed. */
function dragRepeatedly(start: readonly OrderKey[], count: number) {
  let list = [...start];
  const changed: number[] = [];
  let isAlwaysAscending = true;
  for (let index = 0; index < count; index += 1) {
    const moved = [list[0], list.at(-1), ...list.slice(1, -1)];
    const assigned = assign(moved);
    isAlwaysAscending &&= isAscending(assigned);
    changed.push(listChanged(moved, assigned).length);
    list = assigned;
  }
  return { list, changed, isAlwaysAscending };
}

describe("order key", () => {
  it("makes a first key, one after the last and one before the first", () => {
    const first = between();
    expect(parse(first)).toBe(first);
    expect(isAscending([between(undefined, first), first, between(first)])).toBe(true);
  });

  it.each([
    ["1", "2"],
    ["1", "11"],
    ["01", "1"],
    ["V", "W"],
    ["Vz", "W"],
    ["Vzz", "W1"],
    ["y", "z"],
    ["z", "zz"],
    ["0001", "0002"],
  ])("makes a key strictly between %s and %s", (low, high) => {
    expect(isAscending([low, between(createKey(low), createKey(high)), high])).toBe(true);
  });

  it("makes the shortest key where the longer neighbor leaves room at its first digit", () => {
    expect(between(createKey("1"), createKey("2z"))).toBe("2");
    expect(between(createKey("Vz"), createKey("W1"))).toBe("W");
  });

  it("makes keys before keys that start with zeros", () => {
    expect(isAscending([between(undefined, createKey("0001")), "0001"])).toBe(true);
  });

  it("refuses to make a key between two that aren't in order", () => {
    expect(() => between(createKey("2"), createKey("1"))).toThrow(RangeError);
    expect(() => between(createKey("2"), createKey("2"))).toThrow(RangeError);
  });

  it("stays valid and in order after many insertions into the same gap", () => {
    const { keys, low, high } = insertIntoGap(300);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isAscending(keys.toSorted())).toBe(true);
    expect(isAscending([low, high])).toBe(true);
  });

  it("stays in order after many insertions at the start and at the end", () => {
    expect(isAscending(insertAtEnds(300))).toBe(true);
  });

  it("spreads no keys for an empty list, and the middle key for one", () => {
    expect(spread(0)).toEqual([]);
    expect(spread(1)).toEqual(["V"]);
  });

  it.each([2, 61, 62, 100, 3843, 3844, 5000])(
    "spreads %i keys evenly, in order and short",
    (count) => {
      const keys = spread(count);
      expect(keys).toHaveLength(count);
      expect(isAscending(keys)).toBe(true);
      expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(3);
    },
  );

  it("sorts by key, and equal keys by activity id", () => {
    const a = { key: createKey("1"), id: "b" };
    const b = { key: createKey("2"), id: "a" };
    const c = { key: createKey("2"), id: "c" };
    expect([c, b, a].toSorted(compare)).toEqual([a, b, c]);
    expect(compare(a, a)).toBe(0);
    expect(compare(b, c)).toBeLessThan(0);
    expect(compare(c, b)).toBeGreaterThan(0);
    expect(compare(b, a)).toBeGreaterThan(0);
  });

  it("parses keys of up to 100 digits", () => {
    expect(parse("1")).toBe("1");
    expect(parse("z".repeat(100))).toBe("z".repeat(100));
  });

  it.each(["", "10", "0", "a-b", "é", " 1", "z".repeat(101), 1, null])(
    "refuses %j as a key",
    (value) => {
      expect(parse(value)).toBeUndefined();
    },
  );

  describe("assign", () => {
    const keys = spread(5);

    it("keeps every key of a list whose order didn't change", () => {
      expect(assign(keys)).toEqual(keys);
    });

    it.each(listMoves(keys))(
      "gives one activity dragged to a new place the only new key",
      (...moved) => {
        const assigned = assign(moved);
        expect(isAscending(assigned)).toBe(true);
        expect(listChanged(moved, assigned)).toHaveLength(1);
      },
    );

    it("gives a new activity at the end a key after the last, and keeps the rest", () => {
      const assigned = assign([...keys, undefined]);
      expect(assigned.slice(0, -1)).toEqual(keys);
      expect(isAscending(assigned)).toBe(true);
    });

    it("gives new activities anywhere keys between their neighbors", () => {
      const assigned = assign([undefined, keys[0], undefined, undefined, keys[1], undefined]);
      expect(isAscending(assigned)).toBe(true);
      expect(assigned[1]).toBe(keys[0]);
      expect(assigned[4]).toBe(keys[1]);
    });

    it("gives a list of only new activities keys in order", () => {
      expect(isAscending(assign([undefined, undefined, undefined]))).toBe(true);
      expect(assign([])).toEqual([]);
    });

    it("gives a reversed list new keys for all but one", () => {
      const reversed = keys.toReversed();
      const assigned = assign(reversed);
      expect(isAscending(assigned)).toBe(true);
      expect(listChanged(reversed, assigned)).toHaveLength(keys.length - 1);
    });

    it("keeps the longest run in order, wherever it is", () => {
      const [a, b, c, d, e] = keys;
      const list = [d, e, a, b, c];
      const assigned = assign(list);
      expect(isAscending(assigned)).toBe(true);
      expect(listChanged(list, assigned)).toEqual([0, 1]);
    });

    it("keeps the earliest keys of two runs in order that are as long", () => {
      const [a, b, c] = keys;
      expect(listChanged([b, a, c], assign([b, a, c]))).toEqual([1]);
    });

    it("keeps a new key of exactly the longest a key can be", () => {
      // The gap needs one digit more than these 99, which makes a key of 100.
      const low = createKey(`V${"z".repeat(97)}y`);
      const high = createKey(`V${"z".repeat(98)}`);
      const assigned = assign([low, undefined, high]);
      expect(assigned[0]).toBe(low);
      expect(assigned[2]).toBe(high);
      expect(assigned[1]).toHaveLength(100);
    });

    it("gives one of two equal keys a new one, since nothing fits between them", () => {
      const same = createKey("V");
      const assigned = assign([same, same]);
      expect(isAscending(assigned)).toBe(true);
      expect(assigned[0]).toBe(same);
    });

    it("spreads the whole list when a key would grow too long, and stays in order", () => {
      const { list, changed, isAlwaysAscending } = dragRepeatedly(keys, 1000);
      expect(isAlwaysAscending).toBe(true);
      expect(changed.filter((count) => count > 1).length).toBeGreaterThan(0);
      expect(Math.max(...list.map((key) => key.length))).toBeLessThanOrEqual(100);
    });

    it("spreads to the same keys as a new list when it has to", () => {
      // Their last digits are next to each other, so a key between them needs a 101st digit.
      const long = createKey(`V${"z".repeat(98)}y`);
      const longer = createKey(`V${"z".repeat(99)}`);
      expect(assign([long, undefined, longer])).toEqual(spread(3));
    });
  });
});
