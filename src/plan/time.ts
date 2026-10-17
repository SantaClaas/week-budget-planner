import type { Brand } from "../brand";

/** Minutes per slot. Every start and length snaps to it. */
export const SLOT = 15;
/** Minutes in a day. */
export const DAY = 1440;
/** Minutes in the week. The week wraps: Sunday night continues into Monday morning. */
export const WEEK = 7 * DAY;
/** The longest a block can be. */
export const MAX_LENGTH = DAY;

/** The day of the week, 0 for Monday to 6 for Sunday. Temporal's `dayOfWeek` is 1 to 7 instead. */
export type DayIndex = Brand<number, "DayIndex">;
/** Minutes from midnight where a block starts: a multiple of the slot, 0 to 1425. */
export type DayMinute = Brand<number, "DayMinute">;
/** Minutes from Monday 00:00, 0 to 10079. A block's start on the week, for overlaps and slots. */
export type WeekMinute = Brand<number, "WeekMinute">;
/** A block's length in minutes: a multiple of the slot, 15 to 1440. */
export type Length = Brand<number, "Length">;
/** An activity's budget in minutes, per week or per day: a multiple of the slot, at least one slot. */
export type BudgetMinutes = Brand<number, "BudgetMinutes">;
/** How many days per week a per-day budget counts, 1 to 7. */
export type DayCount = Brand<number, "DayCount">;
/** A whole hour of the day, 0 to 24, for the day hours. */
export type Hour = Brand<number, "Hour">;

/**
 * Gives a checked number its brand. The sanitizers and parsers below are the only callers, and only
 * with values they've just made valid, so this is the one type assertion in the module.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Value is the brand to give: a return-only type parameter is what makes this the cast.
function brand<Value extends Brand<number, string>>(value: number): Value {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked number becomes a brand (see Branded types in docs/CODING-GUIDELINES.md).
  return value as Value;
}

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Rounds to the nearest slot. */
export const snap = (minutes: number): number => Math.round(minutes / SLOT) * SLOT;

/** Rounds down to the slot that contains the minute, for pointer positions. */
export const snapDown = (minutes: number): number => Math.floor(minutes / SLOT) * SLOT;

const modulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/** `fallback` when the value isn't a number at all, otherwise the value rounded and clamped. */
function sanitizeInteger(value: number, low: number, high: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(Math.round(value), low, high) : fallback;
}

// Sanitizers never fail: they turn any number into the nearest valid value, for data that was
// loaded (storage, an import, another tab) or computed. Forms use the strict parsers below instead.

export const sanitizeDayIndex = (value: number, fallback = 0): DayIndex =>
  brand<DayIndex>(sanitizeInteger(value, 0, 6, fallback));

/** Wraps any day number around the week, so 7 is Monday again and -1 is Sunday. */
export const wrapDayIndex = (value: number): DayIndex =>
  brand<DayIndex>(modulo(Math.round(value), 7));

export const sanitizeDayMinute = (value: number, fallback = 540): DayMinute =>
  brand<DayMinute>(clamp(snap(sanitizeInteger(value, 0, DAY, fallback)), 0, DAY - SLOT));

/** Wraps any minute around the week. */
export const wrapWeekMinute = (value: number): WeekMinute => brand<WeekMinute>(modulo(value, WEEK));

export const sanitizeLength = (value: number, fallback = 60): Length =>
  brand<Length>(clamp(snap(sanitizeInteger(value, SLOT, MAX_LENGTH, fallback)), SLOT, MAX_LENGTH));

/** Per day at most a day, per week at most a week. */
export const sanitizeBudgetMinutes = (
  value: number,
  mode: "week" | "day",
  fallback = 60,
): BudgetMinutes =>
  brand<BudgetMinutes>(
    Math.max(SLOT, snap(sanitizeInteger(value, SLOT, mode === "day" ? DAY : WEEK, fallback))),
  );

export const sanitizeDayCount = (value: number, fallback = 5): DayCount =>
  brand<DayCount>(sanitizeInteger(value, 1, 7, fallback));

/** The first of the day hours, 0 to 12. */
export const sanitizeDayStart = (value: number, fallback = 7): Hour =>
  brand<Hour>(sanitizeInteger(value, 0, 12, fallback));

/** The end of the day hours, 13 to 24. */
export const sanitizeDayEnd = (value: number, fallback = 22): Hour =>
  brand<Hour>(sanitizeInteger(value, 13, 24, fallback));

// Strict parsers, for what the user types or picks: they reject a value out of range instead of
// clamping it, so the form can say what's wrong (see Activities in docs/SPEC.md).

/**
 * The budget for minutes the user entered, rounded to the slot. "too-small" when there's nothing
 * to count, "too-large" for more than a day (per day) or a week (per week).
 */
export function parseBudgetMinutes(
  minutes: number,
  mode: "week" | "day",
): BudgetMinutes | "too-small" | "too-large" {
  if (!(minutes > 0)) return "too-small";
  if (minutes > (mode === "day" ? DAY : WEEK)) return "too-large";
  return brand<BudgetMinutes>(Math.max(SLOT, snap(minutes)));
}

/** A whole number of days from 1 to 7, or undefined. */
export const parseDayCount = (value: number): DayCount | undefined =>
  Number.isInteger(value) && value >= 1 && value <= 7 ? brand<DayCount>(value) : undefined;

/** A whole hour from 0 to 12, or undefined. */
export const parseDayStart = (value: number): Hour | undefined =>
  Number.isInteger(value) && value >= 0 && value <= 12 ? brand<Hour>(value) : undefined;

/** A whole hour from 13 to 24, or undefined. */
export const parseDayEnd = (value: number): Hour | undefined =>
  Number.isInteger(value) && value >= 13 && value <= 24 ? brand<Hour>(value) : undefined;
