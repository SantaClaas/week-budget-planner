/**
 * Lengths, clock times and weekdays as the user reads them, written by `Intl` in the user's
 * language and conventions (see docs/spec/dates-and-language.md).
 */

import type { Brand } from "../brand.ts";

/**
 * A value for HTML's `datetime` attribute, as `formatClockDatetime` and `formatLengthDatetime`
 * write it: "10:30" or "PT1H30M". Its own type, so the text people read can't end up where machines
 * read the value.
 */
export type Datetime = Brand<string, "Datetime">;

/** Only the two formatters below write a `Datetime`, each from Temporal's own `toString()`. */
// oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a written value becomes a Datetime (see Branded types in docs/guidelines/typescript.md).
const brandDatetime = (value: string): Datetime => value as Datetime;

/** How things are written. Empty means the browser's language and its conventions. */
export type Format = {
  /** A BCP 47 language tag, such as "en-GB". */
  locale?: string;
  /** "h23" for a 24-hour clock, "h12" for a 12-hour one. */
  hourCycle?: "h12" | "h23";
};

/** Any Monday: weekdays are formatted from it. */
const REFERENCE_MONDAY = "2024-01-01";

// Creating an `Intl` formatter is slow and the grid formats on every drag frame, so each one is
// made once per set of options.
const durationFormats = new Map<string, Intl.DurationFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function reuseDurationFormat(locale: string | undefined, options: Intl.DurationFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let format = durationFormats.get(key);
  if (!format) durationFormats.set(key, (format = new Intl.DurationFormat(locale, options)));
  return format;
}

function reuseDateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let format = dateTimeFormats.get(key);
  if (!format) dateTimeFormats.set(key, (format = new Intl.DateTimeFormat(locale, options)));
  return format;
}

const toPlainTime = (minutes: number) => {
  const inDay = ((minutes % 1440) + 1440) % 1440;
  return Temporal.PlainTime.from({ hour: Math.floor(inDay / 60), minute: inDay % 60 });
};

// The language's own short time, unless a clock is chosen. `timeStyle` keeps the language's hour
// digits even with another clock ("06:00 pm" in en-GB), so a chosen clock spells them out: no
// leading zero on a 12-hour clock, always two digits on a 24-hour one.
const reuseClockFormat = ({ locale, hourCycle }: Format) =>
  reuseDateTimeFormat(
    locale,
    hourCycle
      ? { hour: hourCycle === "h12" ? "numeric" : "2-digit", minute: "2-digit", hourCycle }
      : { timeStyle: "short" },
  );

/**
 * A length, ignoring its sign: "1 hr, 30 min" (short, for text), "1h 30m" (narrow, for blocks and
 * day totals) or "1 hour, 30 minutes" (long, for screen readers, which read narrow text letter by
 * letter). The words depend on the language.
 */
export function formatLength(
  minutes: number,
  style: "short" | "narrow" | "long" = "short",
  format: Format = {},
): string {
  const total = Math.round(Math.abs(minutes));
  // Every unit is hidden when it's zero, which would leave nothing for a length of zero.
  if (total === 0)
    return reuseDurationFormat(format.locale, { style, minutesDisplay: "always" }).format({
      minutes: 0,
    });
  return reuseDurationFormat(format.locale, { style }).format({
    hours: Math.floor(total / 60),
    minutes: total % 60,
  });
}

/** A minute of the day as a clock time: "07:30" or "7:30 AM". Minutes past midnight wrap. */
export function formatClock(minutes: number, format: Format = {}): string {
  return reuseClockFormat(format).format(toPlainTime(minutes));
}

/** Two clock times as a range: "10:00–11:30" or "10:00 – 11:30 AM". */
export function formatClockRange(start: number, end: number, format: Format = {}): string {
  return reuseClockFormat(format).formatRange(toPlainTime(start), toPlainTime(end));
}

/** Where a piece of a formatted range comes from: its start, its end, or between them. */
export type RangePiece = { text: string; source: "startRange" | "endRange" | "shared" };

/**
 * Two clock times as a range, in pieces, so the start and the end can each go in a `<time>`
 * element: "10:00", "–", "11:30", or "10:00", " – ", "11:30", " AM".
 */
export function formatClockRangeToParts(
  start: number,
  end: number,
  format: Format = {},
): RangePiece[] {
  const pieces: RangePiece[] = [];
  for (const part of reuseClockFormat(format).formatRangeToParts(
    toPlainTime(start),
    toPlainTime(end),
  )) {
    const last = pieces.at(-1);
    // Intl splits each piece into hours, separators and minutes; only where they come from matters.
    if (last?.source === part.source) {
      last.text += part.value;
      continue;
    }
    pieces.push({ text: part.value, source: part.source });
  }
  return pieces;
}

/** A minute of the day as HTML's `datetime` value for a time: "10:30". Minutes past midnight wrap. */
export const formatClockDatetime = (minutes: number): Datetime =>
  brandDatetime(toPlainTime(minutes).toString({ smallestUnit: "minute" }));

/**
 * A length as HTML's `datetime` value for a duration, in hours and minutes: "PT1H30M", and a day
 * stays "PT24H", since HTML durations have no days.
 */
export const formatLengthDatetime = (minutes: number): Datetime =>
  brandDatetime(
    Temporal.Duration.from({ minutes: Math.round(Math.abs(minutes)) })
      .round({ largestUnit: "hour" })
      .toString(),
  );

/** A day of the week, 0 for Monday: "Mon" or "Monday". */
export function formatWeekday(
  day: number,
  width: "short" | "long" = "short",
  format: Format = {},
): string {
  const date = Temporal.PlainDate.from(REFERENCE_MONDAY).add({ days: day });
  return reuseDateTimeFormat(format.locale, { weekday: width }).format(date);
}
