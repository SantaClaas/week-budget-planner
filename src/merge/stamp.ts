// A stamp says when a register was written and by which node: a hybrid logical clock value (see
// "Stamps and the clock" in docs/spec/merge.md).
import type { Brand } from "../brand.ts";
import type { Result } from "../result.ts";

/**
 * The id of a node: 1 to 40 ASCII letters and digits. Narrower than the ids of activities and
 * blocks, so a stamp's text sorts the same everywhere, in JavaScript and in SQLite, and a stamp
 * column can check its form.
 */
export type NodeId = Brand<string, "NodeId">;

/**
 * A stamp in its text form: the time in milliseconds as 13 digits, the counter as 6, then the node
 * id, with hyphens between, as in `1763200000000-000003-K7dq9`. The text sorts the way stamps
 * compare: by time, then counter, then node id.
 */
export type Stamp = Brand<string, "Stamp">;

/**
 * The time a stamp holds: whole milliseconds since 1970, from 0 to 13 digits' worth, which ends in
 * the year 2286. Only the functions below make one, so a stamp's time is always in range.
 */
export type Time = Brand<number, "Time">;

/** A stamp's counter: a whole number from 0 to 999999 (6 digits). */
export type Counter = Brand<number, "Counter">;

/** The latest time a stamp can hold. */
const MAX_TIME = 9_999_999_999_999;
/** The highest counter. */
const MAX_COUNTER = 999_999;

const NODE_ID = /^[0-9A-Za-z]{1,40}$/u;
const STAMP = /^(\d{13})-(\d{6})-([0-9A-Za-z]{1,40})$/u;

/**
 * Gives a checked node id, stamp, time or counter its brand. Only the functions below call it, with text they've
 * just checked or made, so this is the one type assertion in the module.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Value is the brand to give: a return-only type parameter is what makes this the cast.
function brand<Value extends Brand<string, string> | Brand<number, string>>(
  value: string | number,
): Value {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked node id, stamp, time or counter becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as Value;
}

/** The lowest stamp, all zeros with an empty node id: what rows stored before stamps get. */
export const LOWEST: Stamp = brand<Stamp>("0000000000000-000000-");

// The parsers below give back undefined for what they refuse: a problem as text couldn't be told
// apart from a stamp or node id, which are text too.

export const parseNodeId = (text: string): Result<NodeId, undefined> =>
  NODE_ID.test(text) ? brand<NodeId>(text) : undefined;

const isWholeBetween = (value: number, high: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= high;

/**
 * The time a stamp holds for a wall clock reading. A clock before 1970 or after 2286 is held at the
 * nearest end: it's for the edge that reads the clock, which may also tell the person their clock
 * looks wrong (see "A clock that is wrong" in docs/spec/merge.md).
 */
export const sanitizeTime = (instant: Temporal.Instant): Time =>
  brand<Time>(Math.min(MAX_TIME, Math.max(0, Math.floor(instant.epochMilliseconds))));

/** A time given as a number, checked strictly, for tests and for what's received. */
export const parseTime = (value: number): Result<Time, "out-of-range"> =>
  isWholeBetween(value, MAX_TIME) ? brand<Time>(value) : "out-of-range";

/** A counter given as a number, checked strictly. */
export const parseCounter = (value: number): Result<Counter, "out-of-range"> =>
  isWholeBetween(value, MAX_COUNTER) ? brand<Counter>(value) : "out-of-range";

/** The counter a stamp starts with. */
export const FIRST_COUNTER: Counter = brand<Counter>(0);

/** The counter after `counter`, or "out-of-range" when it's the highest. */
export const incrementCounter = (counter: Counter): Result<Counter, "out-of-range"> =>
  parseCounter(counter + 1);

/** The millisecond after `time`, or "out-of-range" when it's the latest a stamp holds. */
export const incrementTime = (time: Time): Result<Time, "out-of-range"> => parseTime(time + 1);

/** A stamp's three parts. The node id is empty only in the lowest stamp. */
type Parts = { time: Time; counter: Counter; node: NodeId | "" };

/** The stamp of `time`, `counter` and `node`. Every part is a brand, so every stamp is valid. */
export function create(time: Time, counter: Counter, node: NodeId): Stamp {
  const timeText = String(time).padStart(13, "0");
  const counterText = String(counter).padStart(6, "0");
  return brand<Stamp>(`${timeText}-${counterText}-${node}`);
}

/** A received stamp, checked strictly: the lowest stamp, or one in the form described at `Stamp`. */
export function parse(value: unknown): Result<Stamp, undefined> {
  if (value === LOWEST) return LOWEST;

  if (typeof value !== "string") return undefined;

  return STAMP.test(value) ? brand<Stamp>(value) : undefined;
}

/** A stamp's three parts. */
export function read(stamp: Stamp): Parts {
  // A node id has no hyphens, so the text splits into exactly the three parts.
  const [time = "", counter = "", node = ""] = stamp.split("-");
  // The text was checked or made by this module, so its parts are in range.
  return {
    time: brand<Time>(Number(time)),
    counter: brand<Counter>(Number(counter)),
    node: node === "" ? "" : brand<NodeId>(node),
  };
}

/**
 * Compares two stamps, for sorting.
 *
 * @returns Below zero when `first` is earlier, above when it's later, zero when they're the same
 *   stamp.
 */
export function compare(first: Stamp, second: Stamp): number {
  if (first < second) return -1;

  return first > second ? 1 : 0;
}
