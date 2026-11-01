/**
 * What the week draws, worked out from the plan as pure data, so it can be tested without a page:
 * each day's heading and blocks, where each block sits and how big it is, its visible time and what
 * a screen reader says for it (see docs/spec/grid-geometry.md and The week in
 * docs/spec/accessibility.md).
 */
import type { Activity } from "../plan/activity/index.ts";
import {
  formatClock,
  formatClockDatetime,
  formatClockRangeToParts,
  formatLength,
  formatLengthDatetime,
  formatWeekday,
  type Datetime,
  type Format,
} from "../plan/format.ts";
import type { BlockId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { layoutLanes, type Lane } from "../plan/lane.ts";
import {
  DAY,
  sanitizeHour,
  wrapDayIndex,
  type DayIndex,
  type DayMinute,
  type Hour,
  type Length,
} from "../plan/time.ts";
import { findPartsOnDay, sumDayTotals, type BlockPart } from "../plan/week.ts";

/** A piece of visible text, in a `<time>` element when it has a `datetime` value. */
export type TimeText = { text: string; datetime?: Datetime };

/**
 * How much room a block has: "regular" shows the name above the time, "short" (30 minutes or less)
 * one line with the length after the name, and "tiny" (15 minutes) the same without the shape.
 */
type BlockSize = "regular" | "short" | "tiny";

/** One block, or one part of an overnight block, as a day draws it. */
export type DrawnBlock = {
  /** Unique within the week: an overnight block has a part on each of its two days. */
  key: `${BlockId}-${BlockPart["kind"]}`;
  activity: Activity;
  part: BlockPart["kind"];
  /** Where this part starts on its day, and how long it is on this day. */
  start: DayMinute;
  length: Length;
  /** Which of its overlapping neighbours' lanes it takes. */
  lane: Lane;
  size: BlockSize;
  /** How many lines of the name fit above the time. */
  nameLines: number;
  /** The visible time, in pieces: "10:00–11:30 · 1h 30m", or only " · 30m" for a short block. */
  time: TimeText[];
  /** What a screen reader says, with the weekday and the length spelled out. */
  spoken: string;
};

export type DrawnDay = {
  /** The day's place in the week, 0 for Monday. */
  index: DayIndex;
  /** The weekday as the header shows it: "Mon". */
  name: string;
  /** The total placed as the header shows it: "3h placed", or "free". */
  total: TimeText[];
  /** The heading as a screen reader says it: "Monday, 3 hours placed". */
  spoken: string;
  isToday: boolean;
  isWeekend: boolean;
  blocks: DrawnBlock[];
};

/** An hour line's label in the gutter. */
export type HourLabel = { hour: Hour; text: string; datetime: Datetime };

/** Minutes per line of a block's name, and the room the padding and the time take (in minutes). */
const MINUTES_PER_NAME_LINE = 20;
const MINUTES_FOR_PADDING_AND_TIME = 30;

/**
 * How many lines of the name fit above the time. The grid is 3rem per hour, so a name line (1rem)
 * is 20 minutes, and the padding (0.5rem), the 2px gap and the time's line (0.875rem) take 30.
 */
const countNameLines = (length: Length): number =>
  Math.max(1, Math.floor((length - MINUTES_FOR_PADDING_AND_TIME) / MINUTES_PER_NAME_LINE));

function sizeOf(length: Length): BlockSize {
  if (length <= 15) return "tiny";
  return length <= 30 ? "short" : "regular";
}

/** A clock time as a piece in a `<time>` element. */
const createClockText = (minutes: number, format: Format): TimeText => ({
  text: formatClock(minutes, format),
  datetime: formatClockDatetime(minutes),
});

/** A length as a piece in a `<time>` element: "1h 30m". */
const createLengthText = (minutes: number, format: Format): TimeText => ({
  text: formatLength(minutes, "narrow", format),
  datetime: formatLengthDatetime(minutes),
});

/**
 * The block's whole range: "10:00–11:30", or "Tue 22:00 – Wed 02:00" for an overnight block, whose
 * range `formatRange` would give a day of the month, which a week without dates doesn't have.
 */
function describeRange(part: BlockPart, format: Format): TimeText[] {
  const { block } = part;
  const end = block.start + block.length;
  if (part.kind === "only") {
    return formatClockRangeToParts(block.start, end, format).map(({ text, source }) => {
      if (source === "shared") return { text };
      return { text, datetime: formatClockDatetime(source === "startRange" ? block.start : end) };
    });
  }
  const startDay = formatWeekday(block.day, "short", format);
  const endDay = formatWeekday(wrapDayIndex(block.day + 1), "short", format);
  return [
    { text: `${startDay} ` },
    createClockText(block.start, format),
    { text: ` – ${endDay} ` },
    createClockText(end, format),
  ];
}

/**
 * What a screen reader says for the part: "Gym, Monday 18:00 to 19:30, 1 hour, 30 minutes", or for
 * the second part of an overnight block "Work, continued from Tuesday, until 02:00".
 */
function speak(part: BlockPart, activity: Activity, format: Format): string {
  const { block } = part;
  const end = block.start + block.length;
  const startDay = formatWeekday(block.day, "long", format);
  if (part.kind === "second") {
    return `${activity.name}, continued from ${startDay}, until ${formatClock(end, format)}`;
  }
  const endDay =
    part.kind === "first" ? `${formatWeekday(wrapDayIndex(block.day + 1), "long", format)} ` : "";
  const range = `${startDay} ${formatClock(block.start, format)} to ${endDay}${formatClock(end, format)}`;
  return `${activity.name}, ${range}, ${formatLength(block.length, "long", format)}`;
}

function drawBlock(part: BlockPart, activity: Activity, lane: Lane, format: Format): DrawnBlock {
  const { length } = part;
  const size = sizeOf(length);
  const lengthText = createLengthText(part.block.length, format);
  return {
    key: `${part.block.id}-${part.kind}`,
    activity,
    part: part.kind,
    start: part.start,
    length,
    lane,
    size,
    nameLines: countNameLines(length),
    time:
      size === "regular"
        ? [...describeRange(part, format), { text: " · " }, lengthText]
        : [{ text: "· " }, lengthText],
    spoken: speak(part, activity, format),
  };
}

/** The header's total: "3h placed", or "free" for a day with nothing on it. */
function describeTotal(minutes: number, format: Format): TimeText[] {
  if (minutes === 0) return [{ text: "free" }];
  return [createLengthText(minutes, format), { text: " placed" }];
}

/**
 * Every day of the week, Monday first, with its blocks in start order. `today` is the weekday to
 * mark as today, if any.
 */
export function layoutWeek(
  plan: Pick<Plan, "activities" | "blocks">,
  today: DayIndex | undefined,
  format: Format = {},
): DrawnDay[] {
  const activities = new Map(plan.activities.map((activity) => [activity.id, activity]));
  const totals = sumDayTotals(plan.blocks);
  return Array.from({ length: 7 }, (_, index) => {
    const day = wrapDayIndex(index);
    const parts = findPartsOnDay(plan.blocks, day);
    const lanes = layoutLanes(parts);
    const total = totals[index] ?? 0;
    const longName = formatWeekday(day, "long", format);
    return {
      index: day,
      name: formatWeekday(day, "short", format),
      total: describeTotal(total, format),
      spoken:
        total === 0
          ? `${longName}, nothing placed`
          : `${longName}, ${formatLength(total, "long", format)} placed`,
      isToday: day === today,
      isWeekend: index >= 5,
      blocks: parts.flatMap((part) => {
        const activity = activities.get(part.block.activityId);
        if (activity === undefined) return [];
        const lane = lanes.get(part.block.id) ?? { index: 0, count: 1 };
        return [drawBlock(part, activity, lane, format)];
      }),
    };
  });
}

/** The gutter's labels: every hour line from 01:00 to 23:00. */
export function listHours(format: Format = {}): HourLabel[] {
  return Array.from({ length: 23 }, (_, index) => {
    const minutes = (index + 1) * 60;
    return {
      hour: sanitizeHour(index + 1),
      text: formatClock(minutes, format),
      datetime: formatClockDatetime(minutes),
    };
  });
}

/**
 * The hour the week opens scrolled to: the earlier of the day hours' start and the earliest block
 * start in the week, rounded down to the full hour. The second part of an overnight block always
 * starts at midnight, so only starts on a block's own day count (see docs/spec/grid-geometry.md).
 */
export function findOpeningHour(plan: Pick<Plan, "blocks" | "dayStart">): Hour {
  const earliest = plan.blocks.values().reduce((first, block) => Math.min(first, block.start), DAY);
  return sanitizeHour(Math.min(plan.dayStart, Math.floor(earliest / 60)));
}
