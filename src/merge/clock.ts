// A node's clock: the latest stamp it has issued or merged (see "Stamps and the clock" in
// docs/spec/merge.md). It's a stamp itself, so it's stored and compared like one.
import * as stamp from "./stamp.ts";

/**
 * The stamp for the node's next action, which is also its clock from then on. It takes the later
 * of `now` and the clock's time; where that is the clock's time, the clock's counter plus one. A
 * counter that would pass 999999 moves the time on by a millisecond instead. So the stamp is later
 * than everything the node has seen, whatever its wall clock says.
 */
export function next(clock: stamp.Stamp, now: Temporal.Instant, node: stamp.NodeId): stamp.Stamp {
  const last = stamp.read(clock);
  const wall = Math.max(0, now.epochMilliseconds);
  if (wall > last.time) return stamp.create(wall, 0, node);

  if (last.counter < stamp.MAX_COUNTER) return stamp.create(last.time, last.counter + 1, node);

  return stamp.create(last.time + 1, 0, node);
}

/** The clock once the node has merged something stamped `seen`: the later of the two. */
export const advance = (clock: stamp.Stamp, seen: stamp.Stamp): stamp.Stamp =>
  stamp.compare(seen, clock) > 0 ? seen : clock;
