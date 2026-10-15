import type { BlockPart } from "./week";

export type Lane = { lane: number; lanes: number };

/**
 * Places a day's parts side by side like a standard calendar: parts that overlap (directly or
 * through others) form a group, each part takes the first lane whose last end is at or before its
 * start, and every part in the group shares the group's lane count. Keyed by block id.
 */
export function layoutLanes(parts: readonly BlockPart[]): Map<string, Lane> {
  const sorted = [...parts].sort((first, second) => first.start - second.start || second.end - first.end);
  const result = new Map<string, Lane>();
  let group: BlockPart[] = [];
  let groupEnd = -1;

  const closeGroup = () => {
    const laneEnds: number[] = [];
    for (const part of group) {
      let lane = laneEnds.findIndex((end) => end <= part.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = part.end;
      result.set(part.block.id, { lane, lanes: 1 });
    }
    for (const part of group) result.get(part.block.id)!.lanes = laneEnds.length;
    group = [];
    groupEnd = -1;
  };

  for (const part of sorted) {
    if (group.length && part.start >= groupEnd) closeGroup();
    group.push(part);
    groupEnd = Math.max(groupEnd, part.end);
  }
  if (group.length) closeGroup();
  return result;
}
