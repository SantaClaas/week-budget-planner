/**
 * What a drag on the week does to a block, as pure arithmetic on the pointer's place: which day
 * column it's over, and which minute of that day (see Editing blocks in docs/spec/interactions.md).
 * The drag controller measures the page and applies the result; this only computes it.
 */
import type { Block } from "../plan/block/index.ts";
import { DAY, SLOT, clamp, snap, type DayIndex } from "../plan/time.ts";
import { moveTo, resizeEnd, resizeStart, type BlockPart } from "../plan/week.ts";

/** What the pointer took hold of: the block's body to move it, or one of its edges to resize it. */
export type Grip = "body" | "top" | "bottom";

/** Where the pointer is on the week: the day column under it, and the minute of that day. */
export type PointerPlace = { day: DayIndex; minute: number };

/** The minute of the day at a height in a day column, which is the whole day tall. */
export const readMinute = (offsetFromTop: number, columnHeight: number): number =>
  clamp((offsetFromTop / columnHeight) * DAY, 0, DAY);

/**
 * How far into the block, in minutes from its start, the pointer took hold of it, so a move keeps
 * that offset and the block doesn't jump. A second part's minutes count on from midnight.
 */
export function measureGrab(part: Pick<BlockPart, "block" | "kind">, minute: number): number {
  const fromStart =
    part.kind === "second" ? DAY - part.block.start + minute : minute - part.block.start;
  return clamp(fromStart, 0, part.block.length);
}

/**
 * The block once the pointer is at `place`. A move keeps the grab and the length: the start is the
 * slot under the block's top edge, on the day under the pointer (the day before, for a second part
 * held), from 00:00 to 23:45, and the rest runs on past midnight when it doesn't fit. A resize moves
 * one edge, within its part's own day.
 */
export function drag(
  part: Pick<BlockPart, "block" | "kind">,
  grip: Grip,
  grab: number,
  place: PointerPlace,
): Block {
  const { block } = part;
  const isSecond = part.kind === "second";
  if (grip === "top") return resizeStart(block, snap(place.minute));
  if (grip === "bottom") return resizeEnd(block, snap(place.minute) + (isSecond ? DAY : 0));
  const start = place.minute + (isSecond ? DAY : 0) - grab;
  return moveTo(block, place.day - (isSecond ? 1 : 0), clamp(snap(start), 0, DAY - SLOT));
}
