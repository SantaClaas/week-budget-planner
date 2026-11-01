import { parseActivityName, type ActivityName } from "./name.ts";
import { parseBudgetMinutes, parseDayCount, type BudgetMinutes, type DayCount } from "../time.ts";
import type { Mode } from "./index.ts";
import type { Result } from "../../result.ts";

export type ActivityFormInput = {
  name: string;
  /** As typed: "1.5", "1,5", "2". */
  hours: string;
  mode: Mode;
  /** As typed, used only per day. */
  days: string;
};

/** A field of the activity form that can be wrong. */
export type ActivityFormField = "name" | "hours" | "days";

/** What's wrong with each field that is, in the words the form shows under it. */
type Problems = Partial<Record<ActivityFormField, string>>;

export type ActivityFormResult = Result<
  {
    isOk: true;
    value: { name: ActivityName; budgetMinutes: BudgetMinutes; mode: Mode; days: DayCount };
  },
  { isOk: false; problems: Problems }
>;

const decimalSeparators = new Map<string, string>();

/** The language's decimal separator, "." in English and "," in German. */
function findDecimalSeparator(locale: string | undefined): string {
  const key = locale ?? "";
  let separator = decimalSeparators.get(key);
  if (separator === undefined) {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
    separator = parts.find((part) => part.type === "decimal")?.value ?? ".";
    decimalSeparators.set(key, separator);
  }
  return separator;
}

/**
 * A positive decimal number as typed, strictly: "1.5", "1,5" or the language's own separator, and
 * nothing else, so "1.5h" or "1.2.3" is NaN instead of a guess. Hours never need a thousands
 * separator, so a comma is always a decimal separator.
 */
export function parseDecimal(text: string, locale?: string): number {
  const separator = findDecimalSeparator(locale);
  const normalized = text.trim().replaceAll(separator, ".").replaceAll(",", ".");
  return /^\d+(\.\d+)?$|^\.\d+$/u.test(normalized) ? Number(normalized) : NaN;
}

/** What's wrong with the hours as typed, or the budget they make, rounded to the slot. */
function readHours(
  text: string,
  mode: Mode,
  locale: string | undefined,
): Result<BudgetMinutes, string> {
  // An empty field and text that isn't a number both parse to NaN, but get different messages.
  const hours = text.trim();
  const budgetMinutes = parseBudgetMinutes(parseDecimal(hours, locale) * 60, mode);
  if (hours === "" || budgetMinutes === "too-small") {
    return "Enter the hours it needs, for example 1.5.";
  }
  if (budgetMinutes === "unreadable") return "Enter the hours as a number, for example 1.5.";
  if (budgetMinutes === "too-large") {
    return mode === "day"
      ? "A day has 24 hours. Enter 24 or less."
      : "A week has 168 hours. Enter 168 or less.";
  }
  return budgetMinutes;
}

/**
 * Validates the activity form with the prototype's messages, every field at once, so each field
 * can show its own. Hours round to the slot.
 */
export function readActivityForm(input: ActivityFormInput, locale?: string): ActivityFormResult {
  const name = parseActivityName(input.name);
  const budgetMinutes = readHours(input.hours, input.mode, locale);
  // Per week, the days aren't asked for and keep their default.
  const days = parseDayCount(input.mode === "day" ? Number(input.days.trim() || NaN) : 5);
  const problems: Problems = {};
  if (name === "empty") problems.name = "Give the activity a name.";
  if (typeof budgetMinutes === "string") problems.hours = budgetMinutes;
  if (days === "out-of-range") problems.days = "Enter how many days per week, from 1 to 7.";
  if (name === "empty" || typeof budgetMinutes === "string" || days === "out-of-range") {
    return { isOk: false, problems };
  }
  return { isOk: true, value: { name, budgetMinutes, mode: input.mode, days } };
}

/** A budget as the hours field shows it, in the language's own decimals: "1.5", or "1,5" in German. */
export const formatHours = (minutes: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(
    minutes / 60,
  );
