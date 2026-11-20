// A register: the smallest part of a row that merges as one, a value with its stamp (see Registers
// in docs/spec/merge.md).
import type { Result } from "../result.ts";
import { readExact } from "./record.ts";
import { compare as compareStamps, parse as parseStamp, type Stamp } from "./stamp.ts";

/** A plain value, as JSON holds it. */
type Plain = string | number | boolean | null;

/**
 * A register's value: a plain value, or a few of them under names, as the budget's mode, minutes
 * and days are. It's sent as JSON and compared as canonical JSON.
 */
export type Value = Plain | { readonly [key: string]: Plain };

export type Register<Of extends Value> = { readonly value: Of; readonly stamp: Stamp };

/** The value as JSON with every object's keys sorted, so equal values give equal text. */
export function formatCanonical(value: Value): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  // An object's keys are never the same, so they need no case for being equal.
  const entries = Object.entries(value)
    .toSorted(([first], [second]) => (first < second ? -1 : 1))
    .map(([key, each]) => `${JSON.stringify(key)}:${JSON.stringify(each)}`);
  return `{${entries.join(",")}}`;
}

/** Whether two values are the same, field by field, whatever the order of their keys. */
export function isSame(first: Value, second: Value): boolean {
  if (first === second) return true;

  if (typeof first !== "object" || typeof second !== "object" || first === null || second === null)
    return false;

  const keys = Object.keys(first);
  if (keys.length !== Object.keys(second).length) return false;

  return keys.every((key) => Object.hasOwn(second, key) && first[key] === second[key]);
}

/**
 * The register that wins: the one with the later stamp. Equal stamps with different values
 * shouldn't happen, but can (a copied browser profile, rows from before stamps), so the value that
 * sorts later as canonical JSON wins then, and every node still gets the same result. `first` is
 * given back when it wins or both are the same, so a row nothing changed stays the same object.
 */
export function merge<Of extends Value>(first: Register<Of>, second: Register<Of>): Register<Of> {
  const order = compareStamps(first.stamp, second.stamp);
  if (order !== 0) return order > 0 ? first : second;

  if (isSame(first.value, second.value)) return first;

  return formatCanonical(second.value) > formatCanonical(first.value) ? second : first;
}

/**
 * A received register, parsed strictly: a value `parseValue` accepts, and a well-formed stamp.
 * `problem` is what to give back when the value is refused.
 */
export function parse<Of extends Value, Problem extends string>(
  value: unknown,
  parseValue: (value: unknown) => Of | undefined,
  problem: Problem,
): Result<Register<Of>, "not-a-change" | "invalid-stamp" | Problem> {
  const fields = readExact(value, ["value", "stamp"]);
  if (fields === undefined) return "not-a-change";

  const stamp = parseStamp(fields["stamp"]);
  if (stamp === undefined) return "invalid-stamp";

  const checked = parseValue(fields["value"]);
  return checked === undefined ? problem : { value: checked, stamp };
}
