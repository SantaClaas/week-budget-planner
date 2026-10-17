import { formatClock, formatClockRange, formatLength, formatWeekday, type Format } from "./format";
import {
  DAY,
  MAX_LENGTH,
  SLOT,
  WEEK,
  clamp,
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeLength,
  wrapDayIndex,
  wrapWeekMinute,
  type DayIndex,
  type DayMinute,
  type WeekMinute,
} from "./time";
import type { Block } from "./types";

/**
 * Where a block shows on one day. An overnight block has two parts: the end of its own day and the
 * start of the next day (Sunday continues into Monday).
 */
export type BlockPart = {
  block: Block;
  day: DayIndex;
  /** Minutes from that day's midnight, 0 to 1440. */
  start: number;
  end: number;
  /** "only", or which half of an overnight block this is. */
  kind: "only" | "first" | "second";
};

/** The block's start on the week. */
export const calculateWeekStart = (block: Pick<Block, "day" | "start">): WeekMinute =>
  wrapWeekMinute(block.day * DAY + block.start);

export const isOvernight = (block: Pick<Block, "start" | "length">): boolean =>
  block.start + block.length > DAY;

export function splitIntoParts(block: Block): BlockPart[] {
  const end = block.start + block.length;
  if (end <= DAY) return [{ block, day: block.day, start: block.start, end, kind: "only" }];
  return [
    { block, day: block.day, start: block.start, end: DAY, kind: "first" },
    { block, day: wrapDayIndex(block.day + 1), start: 0, end: end - DAY, kind: "second" },
  ];
}

/** Every part that falls on `day`, sorted by start. */
export function findPartsOnDay(blocks: readonly Block[], day: DayIndex): BlockPart[] {
  return blocks
    .flatMap(splitIntoParts)
    .filter((part) => part.day === day)
    .toSorted((first, second) => first.start - second.start || second.end - first.end);
}

/** Whether two ranges on the week overlap, the week wrapping from Sunday into Monday. */
export function isRangeOverlapping(
  startA: WeekMinute,
  lengthA: number,
  startB: WeekMinute,
  lengthB: number,
): boolean {
  // Unroll both ranges onto a line of two weeks and compare every pairing.
  for (const shift of [-WEEK, 0, WEEK]) {
    const shiftedB = startB + shift;
    if (startA < shiftedB + lengthB && shiftedB < startA + lengthA) return true;
  }
  return false;
}

export const isBlockOverlapping = (first: Block, second: Block): boolean =>
  isRangeOverlapping(
    calculateWeekStart(first),
    first.length,
    calculateWeekStart(second),
    second.length,
  );

/** Minutes of each day (Monday first) covered by blocks, counting overnight parts on their own day. */
export function sumDayTotals(blocks: readonly Block[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const part of blocks.flatMap(splitIntoParts)) totals[part.day]! += part.end - part.start;
  return totals;
}

/** Converts minutes on the week back to a day and a start, wrapping around the week. */
export function convertFromWeekMinutes(minutes: number): { day: DayIndex; start: DayMinute } {
  const wrapped = wrapWeekMinute(minutes);
  return {
    day: sanitizeDayIndex(Math.floor(wrapped / DAY)),
    start: sanitizeDayMinute(wrapped % DAY),
  };
}

/** Moving keeps the length; only the day and start change. The start may be any slot. */
export function moveTo(block: Block, day: number, start: number): Block {
  return { ...block, day: wrapDayIndex(day), start: sanitizeDayMinute(start) };
}

/** Moves by a number of minutes, crossing midnight and wrapping the week (keyboard Up/Down). */
export function moveBy(block: Block, minutes: number): Block {
  return { ...block, ...convertFromWeekMinutes(calculateWeekStart(block) + minutes) };
}

/** Moves to the neighbouring day, wrapping the week (keyboard Left/Right). */
export const moveDays = (block: Block, days: number): Block => ({
  ...block,
  day: wrapDayIndex(block.day + days),
});

/**
 * Drags the top edge of the first (or only) part to `start`, keeping the end fixed. The start stays
 * on the block's own day, the length between one slot and a day.
 */
export function resizeStart(block: Block, start: number): Block {
  const end = block.start + block.length;
  const next = clamp(start, Math.max(0, end - MAX_LENGTH), Math.min(DAY - SLOT, end - SLOT));
  return { ...block, start: sanitizeDayMinute(next), length: sanitizeLength(end - next) };
}

/**
 * Drags the bottom edge of the last (or only) part. `end` is in minutes from the block's own day,
 * so an overnight block's end is above 1440. Resizing never moves the edge to another day: a one-day
 * block ends by midnight, and an overnight block's second part can shrink down to midnight.
 */
export function resizeEnd(block: Block, end: number): Block {
  const low = block.start + SLOT;
  const high = isOvernight(block) ? block.start + MAX_LENGTH : DAY;
  const next = clamp(end, isOvernight(block) ? Math.max(low, DAY) : low, high);
  return { ...block, length: sanitizeLength(next - block.start) };
}

/**
 * "10:00–11:30 · 1h 30m", or "Tue 22:00 – Wed 02:00 · 4h" for an overnight block, in the format's
 * language and clock.
 */
export function describeTime(block: Block, format: Format = {}): string {
  const end = block.start + block.length;
  const length = formatLength(block.length, "narrow", format);
  if (end <= DAY) return `${formatClockRange(block.start, end, format)} · ${length}`;
  // `formatRange` would add the day of the month, which a week without dates doesn't have.
  const startDay = formatWeekday(block.day, "short", format);
  const endDay = formatWeekday(wrapDayIndex(block.day + 1), "short", format);
  return `${startDay} ${formatClock(block.start, format)} – ${endDay} ${formatClock(end, format)} · ${length}`;
}
