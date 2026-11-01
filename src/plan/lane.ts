import type { BlockId } from "./id.ts";
import type { BlockPart } from "./week.ts";

/** Where a part sits among the parts it overlaps: lane `index` of `count`, side by side. */
export type Lane = { index: number; count: number };

/**
 * Places a day's parts side by side like a standard calendar: parts that overlap (directly or
 * through others) form a group, each part takes the first lane whose last end is at or before its
 * start, and every part in the group shares the group's lane count. Keyed by block id.
 */
export function layoutLanes(parts: readonly BlockPart[]): Map<BlockId, Lane> {
  const sorted = parts.toSorted(
    (first, second) => first.start - second.start || second.end - first.end,
  );
  const result = new Map<BlockId, Lane>();
  let group: BlockPart[] = [];
  let groupEnd = -1;

  const closeGroup = (): void => {
    const laneEnds: number[] = [];
    const placed: { part: BlockPart; lane: number }[] = [];
    for (const part of group) {
      let lane = laneEnds.findIndex((end) => end <= part.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = part.end;
      placed.push({ part, lane });
    }
    // Every part in the group shares the group's lane count, known once all are placed.
    for (const { part, lane } of placed)
      result.set(part.block.id, { index: lane, count: laneEnds.length });
    group = [];
    groupEnd = -1;
  };

  for (const part of sorted) {
    if (group.length > 0 && part.start >= groupEnd) closeGroup();
    group.push(part);
    groupEnd = Math.max(groupEnd, part.end);
  }
  if (group.length > 0) closeGroup();
  return result;
}
