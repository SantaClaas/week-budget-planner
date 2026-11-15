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

/** The latest time a stamp can hold: 13 digits of milliseconds, in the year 2286. */
const MAX_TIME = 9_999_999_999_999;
/** The highest counter: 6 digits. */
export const MAX_COUNTER = 999_999;

const NODE_ID = /^[0-9A-Za-z]{1,40}$/u;
const STAMP = /^(\d{13})-(\d{6})-([0-9A-Za-z]{1,40})$/u;

/**
 * Gives a checked node id or stamp its brand. Only the functions below call it, with text they've
 * just checked or made, so this is the one type assertion in the module.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Value is the brand to give: a return-only type parameter is what makes this the cast.
function brand<Value extends Brand<string, string>>(value: string): Value {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked node id or stamp becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as Value;
}

/** The lowest stamp, all zeros with an empty node id: what rows stored before stamps get. */
export const LOWEST: Stamp = brand<Stamp>("0000000000000-000000-");

// The parsers below give back undefined for what they refuse: a problem as text couldn't be told
// apart from a stamp or node id, which are text too.

export const parseNodeId = (text: string): Result<NodeId, undefined> =>
  NODE_ID.test(text) ? brand<NodeId>(text) : undefined;

/** A stamp's three parts. The node id is empty only in the lowest stamp. */
type Parts = { time: number; counter: number; node: NodeId | "" };

/**
 * The stamp of `time`, `counter` and `node`. Throws on parts out of range: the clock only passes
 * parts it has kept in range, so one that isn't is a mistake in the code.
 */
export function create(time: number, counter: number, node: NodeId): Stamp {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME)
    throw new RangeError(`A stamp's time must be 0 to ${String(MAX_TIME)}, not ${String(time)}.`);
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER)
    throw new RangeError(`A stamp's counter must be 0 to 999999, not ${String(counter)}.`);
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
  return {
    time: Number(time),
    counter: Number(counter),
    node: node === "" ? "" : brand<NodeId>(node),
  };
}

/** Below zero when `first` is earlier, above when it's later, zero when they're the same stamp. */
export function compare(first: Stamp, second: Stamp): number {
  if (first < second) return -1;
  return first > second ? 1 : 0;
}
