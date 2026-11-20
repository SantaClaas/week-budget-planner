// Order keys: the text an activity is sorted by in the Activities list (see Order in
// docs/spec/merge.md). A key is a fraction written in base 62 without its "0.", so a new key can
// always be made between two others (fractional indexing), and moving an activity changes its key
// alone.
//
// Making a key between two others follows David Greenspan's "Implementing Fractional Indexing"
// (https://observablehq.com/@dgreensp/implementing-fractional-indexing), written anew here.
import type { Brand } from "../brand.ts";
import type { Result } from "../result.ts";

/**
 * An order key: 1 to 100 digits of base 62 (0-9, A-Z, a-z, which sort in that order as text),
 * not ending in "0", so there is always room for a key before it.
 */
export type OrderKey = Brand<string, "OrderKey">;

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
/**
 * The longest key. Keys grow by about a digit for every six moves into the same gap, so it takes
 * hundreds of them to reach it; a list that would pass it gets evenly spread keys instead.
 */
const MAX_LENGTH = 100;
const KEY = /^[0-9A-Za-z]{0,99}[1-9A-Za-z]$/u;

/**
 * Gives a checked or newly made key its brand. Only the functions below call it, with keys they've
 * just checked or made, so this is the one type assertion in the module.
 */
function brand(value: string): OrderKey {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked key becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as OrderKey;
}

/**
 * A received key, checked strictly, or undefined when it isn't one: a problem as text couldn't be
 * told apart from a key.
 */
export const parse = (value: unknown): Result<OrderKey, undefined> =>
  typeof value === "string" && KEY.test(value) ? brand(value) : undefined;

const readDigit = (text: string, index: number): number => DIGITS.indexOf(text[index] ?? "0");

/**
 * Digits that sort after `low` and don't end in "0": a key at the end of the list.
 *
 * @param low - The last key, or empty for a list with none.
 */
function findAfter(low: string): string {
  const lowDigit = readDigit(low, 0);
  if (BASE - lowDigit > 1) return DIGITS[Math.round((lowDigit + BASE) / 2)] ?? "";

  // The first digit is the highest there is: keep it, and look for room after the rest of `low`.
  return (DIGITS[lowDigit] ?? "") + findAfter(low.slice(1));
}

/**
 * Digits that sort strictly between `low` and `high` and don't end in "0".
 *
 * @param low - The key below the gap, or empty at the start of the list.
 * @param high - The key above the gap, which sorts after `low`.
 */
function findBetween(low: string, high: string): string {
  let shared = 0;
  while ((low[shared] ?? "0") === high[shared]) shared += 1;

  if (shared > 0) return high.slice(0, shared) + findBetween(low.slice(shared), high.slice(shared));

  const lowDigit = readDigit(low, 0);
  const highDigit = readDigit(high, 0);
  if (highDigit - lowDigit > 1) return DIGITS[Math.round((lowDigit + highDigit) / 2)] ?? "";

  // The first digits are next to each other. A longer `high` leaves room right at its first digit;
  // otherwise keep the low digit, and anything after the rest of `low` fits.
  if (high.length > 1) return high.slice(0, 1);

  return (DIGITS[lowDigit] ?? "") + findAfter(low.slice(1));
}

/** A key after `last`: the end of the list. */
export const createAfter = (last: OrderKey): OrderKey => brand(findAfter(last));

/** A key before `first`: the start of the list. */
export const createBefore = (first: OrderKey): OrderKey => brand(findBetween("", first));

/**
 * A key strictly between two others.
 *
 * @param before - The key below.
 * @param after - The key above.
 * @throws {RangeError} When `before` isn't below `after`: then no key fits, and the digits it would
 *   make sort wrong, which is a mistake in the code that calls it. The keys `assign` passes come
 *   from a run that ascends strictly, so it never does.
 */
export function createBetween(before: OrderKey, after: OrderKey): OrderKey {
  if (before >= after) throw new RangeError(`No key fits between "${before}" and "${after}".`);

  return brand(findBetween(before, after));
}

/**
 * Keys in order in a gap of the list, split in halves so they stay short.
 *
 * @param low - The key the gap starts after, or empty at the start of the list.
 * @param high - The key the gap ends before, or undefined at the end of the list.
 * @param count - How many keys.
 */
function listInGap(low: string, high: OrderKey | undefined, count: number): OrderKey[] {
  if (count === 0) return [];

  const middle = brand(high === undefined ? findAfter(low) : findBetween(low, high));
  const half = Math.floor((count - 1) / 2);
  return [...listInGap(low, middle, half), middle, ...listInGap(middle, high, count - 1 - half)];
}

/** `count` keys spread evenly, in order, all of the same few digits: for an existing list. */
export function spread(count: number): OrderKey[] {
  let digits = 1;
  while (BASE ** digits <= count) digits += 1;

  const step = BASE ** digits / (count + 1);
  return Array.from({ length: count }, (_, index) => {
    let value = Math.floor(step * (index + 1));
    let text = "";
    for (let place = 0; place < digits; place += 1) {
      text = (DIGITS[value % BASE] ?? "") + text;
      value = Math.floor(value / BASE);
    }

    // Dropping the zeros at the end keeps the order: all keys have the same number of digits.
    return brand(text.replace(/0+$/u, ""));
  });
}

/** What the Activities list is sorted by: the order key, and the id where keys are equal. */
type Ordered = { readonly key: OrderKey; readonly id: string };

/**
 * Compares two activities by where they come in the list, for sorting.
 *
 * @returns Below zero when `first` comes first, above when `second` does, zero for the same id.
 */
export function compare(first: Ordered, second: Ordered): number {
  if (first.key !== second.key) return first.key < second.key ? -1 : 1;

  if (first.id === second.id) return 0;

  return first.id < second.id ? -1 : 1;
}

/**
 * The positions of a longest run of keys that, skipping the others, already ascend strictly. When
 * there are several, the one that ends earliest and, from there, keeps the earliest keys.
 */
function findAscending(keys: readonly (OrderKey | undefined)[]): Set<number> {
  /** By position: the length of the longest run that ends there, and the position before it. */
  const lengths = new Map<number, number>();
  const previous = new Map<number, number>();
  let best: number | undefined;
  for (const [index, key] of keys.entries()) {
    if (key === undefined) continue;

    let length = 1;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const earlierKey = keys[earlier];
      const earlierLength = lengths.get(earlier) ?? 0;
      if (earlierKey === undefined || earlierKey >= key || earlierLength + 1 <= length) continue;

      length = earlierLength + 1;
      previous.set(index, earlier);
    }

    lengths.set(index, length);
    if (best === undefined || length > (lengths.get(best) ?? 0)) best = index;
  }

  const kept = new Set<number>();
  for (let index = best; index !== undefined; index = previous.get(index)) kept.add(index);

  return kept;
}

/**
 * Keys for a list in its new order. As many keys as possible stay as they are: those of a longest
 * run already in order. The others get new keys between their neighbors, so one activity dragged to
 * a new place is the one whose key changes, and a new activity at the end gets a key after the
 * last. Two equal keys can't both stay, since nothing would fit between them. Should a new key grow
 * past the longest a key can be, the whole list gets evenly spread keys instead.
 *
 * @param keys - Each item's key so far, in the new order, and undefined for a new item.
 * @returns A key for each item, in the same order.
 */
export function assign(keys: readonly (OrderKey | undefined)[]): OrderKey[] {
  const kept = findAscending(keys);
  const assigned: OrderKey[] = [];
  let waiting = 0;
  let before = "";
  const fill = (after?: OrderKey): void => {
    assigned.push(...listInGap(before, after, waiting));
    waiting = 0;
  };
  for (const [index, key] of keys.entries()) {
    if (key === undefined || !kept.has(index)) {
      waiting += 1;
      continue;
    }

    fill(key);
    assigned.push(key);
    before = key;
  }

  fill();
  const isTooLong = assigned.some((key) => key.length > MAX_LENGTH);
  return isTooLong ? spread(keys.length) : assigned;
}
