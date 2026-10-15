import { DAY, DAY_NAMES, MAX_LENGTH, SLOT, WEEK, type Block } from "./types";
import { clamp, formatClock, formatShort } from "./time";

/**
 * Where a block shows on one day. An overnight block has two parts: the end of its own day and the
 * start of the next day (Sunday continues into Monday).
 */
export type BlockPart = {
  block: Block;
  day: number;
  /** Minutes from that day's midnight. */
  start: number;
  end: number;
  /** "only", or which half of an overnight block this is. */
  kind: "only" | "first" | "second";
};

const modulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/** The block's start in week minutes, 0 to 10079. */
export const calculateWeekStart = (block: Pick<Block, "day" | "start">): number =>
  block.day * DAY + block.start;

export const isOvernight = (block: Pick<Block, "start" | "length">): boolean =>
  block.start + block.length > DAY;

export function splitIntoParts(block: Block): BlockPart[] {
  const end = block.start + block.length;
  if (end <= DAY) return [{ block, day: block.day, start: block.start, end, kind: "only" }];
  return [
    { block, day: block.day, start: block.start, end: DAY, kind: "first" },
    { block, day: modulo(block.day + 1, 7), start: 0, end: end - DAY, kind: "second" },
  ];
}

/** Every part that falls on `day`, sorted by start. */
export function findPartsOnDay(blocks: readonly Block[], day: number): BlockPart[] {
  return blocks
    .flatMap(splitIntoParts)
    .filter((part) => part.day === day)
    .sort((first, second) => first.start - second.start || second.end - first.end);
}

/** Whether two week-minute ranges overlap on the wrapping week. */
export function rangesOverlap(
  startA: number,
  lengthA: number,
  startB: number,
  lengthB: number,
): boolean {
  // Unroll both ranges onto a line of two weeks and compare every pairing.
  const wrappedA = modulo(startA, WEEK);
  const wrappedB = modulo(startB, WEEK);
  for (const shift of [-WEEK, 0, WEEK]) {
    const shiftedB = wrappedB + shift;
    if (wrappedA < shiftedB + lengthB && shiftedB < wrappedA + lengthA) return true;
  }
  return false;
}

export const blocksOverlap = (first: Block, second: Block): boolean =>
  rangesOverlap(calculateWeekStart(first), first.length, calculateWeekStart(second), second.length);

/** Minutes of each day (Monday first) covered by blocks, counting overnight parts on their own day. */
export function sumDayTotals(blocks: readonly Block[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const part of blocks.flatMap(splitIntoParts)) totals[part.day]! += part.end - part.start;
  return totals;
}

/** Converts week minutes back to a day and a start, wrapping around the week. */
export function convertFromWeekMinutes(minutes: number): { day: number; start: number } {
  const wrapped = modulo(minutes, WEEK);
  return { day: Math.floor(wrapped / DAY), start: wrapped % DAY };
}

/** Moving keeps the length; only the day and start change. The start may be any slot. */
export function moveTo(block: Block, day: number, start: number): Block {
  return { ...block, day: modulo(day, 7), start: clamp(start, 0, DAY - SLOT) };
}

/** Moves by a number of minutes, crossing midnight and wrapping the week (keyboard Up/Down). */
export function moveBy(block: Block, minutes: number): Block {
  return { ...block, ...convertFromWeekMinutes(calculateWeekStart(block) + minutes) };
}

/** Moves to the neighbouring day, wrapping the week (keyboard Left/Right). */
export const moveDays = (block: Block, days: number): Block => ({
  ...block,
  day: modulo(block.day + days, 7),
});

/**
 * Drags the top edge of the first (or only) part to `start`, keeping the end fixed. The start stays
 * on the block's own day, the length between one slot and a day.
 */
export function resizeStart(block: Block, start: number): Block {
  const end = block.start + block.length;
  const next = clamp(start, Math.max(0, end - MAX_LENGTH), Math.min(DAY - SLOT, end - SLOT));
  return { ...block, start: next, length: end - next };
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
  return { ...block, length: next - block.start };
}

/** "10:00–11:30 · 1h30", or "Tue 22:00 – Wed 02:00 · 4h" for an overnight block. */
export function describeTime(block: Block): string {
  const end = block.start + block.length;
  const lengthLabel = formatShort(block.length);
  if (end <= DAY) return `${formatClock(block.start)}–${formatClock(end)} · ${lengthLabel}`;
  const nextDay = DAY_NAMES[modulo(block.day + 1, 7)];
  return `${DAY_NAMES[block.day]} ${formatClock(block.start)} – ${nextDay} ${formatClock(end)} · ${lengthLabel}`;
}
