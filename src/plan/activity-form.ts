import { parseActivityName, type ActivityName } from "./activity-name.ts";
import { parseBudgetMinutes, parseDayCount, type BudgetMinutes, type DayCount } from "./time.ts";
import type { Mode } from "./types.ts";

export type ActivityFormInput = {
  name: string;
  /** As typed: "1.5", "1,5", "2". */
  hours: string;
  mode: Mode;
  /** As typed, used only per day. */
  days: string;
};

export type ActivityFormResult =
  | {
      ok: true;
      value: { name: ActivityName; budgetMinutes: BudgetMinutes; mode: Mode; days: DayCount };
    }
  | { ok: false; field: "name" | "hours" | "days"; message: string };

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

/** Validates the activity form with the prototype's messages. Hours round to the slot. */
export function readActivityForm(input: ActivityFormInput, locale?: string): ActivityFormResult {
  const name = parseActivityName(input.name);
  if (name === "empty") return { ok: false, field: "name", message: "Give the activity a name." };
  // An empty field and text that isn't a number both parse to NaN, but get different messages.
  const hours = input.hours.trim();
  const budgetMinutes = parseBudgetMinutes(parseDecimal(hours, locale) * 60, input.mode);
  if (hours === "" || budgetMinutes === "too-small") {
    return { ok: false, field: "hours", message: "Enter the hours it needs, for example 1.5." };
  }
  if (budgetMinutes === "unreadable") {
    return { ok: false, field: "hours", message: "Enter the hours as a number, for example 1.5." };
  }
  if (budgetMinutes === "too-large") {
    const message =
      input.mode === "day"
        ? "A day has 24 hours. Enter 24 or less."
        : "A week has 168 hours. Enter 168 or less.";
    return { ok: false, field: "hours", message };
  }
  // Per week, the days aren't asked for and keep their default.
  const days = parseDayCount(input.mode === "day" ? Number(input.days.trim() || NaN) : 5);
  if (days === undefined) {
    return { ok: false, field: "days", message: "Enter how many days per week, from 1 to 7." };
  }
  return { ok: true, value: { name, budgetMinutes, mode: input.mode, days } };
}
