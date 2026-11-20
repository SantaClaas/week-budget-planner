// A node's clock: the latest stamp it has issued or merged (see "Stamps and the clock" in
// docs/spec/merge.md). It's a stamp itself, so it's stored and compared like one.
import type { Result } from "../result.ts";
import * as stamp from "./stamp.ts";

/**
 * The stamp for the node's next action, which is also its clock from then on. It takes the later
 * of the wall clock and the clock's time; where that is the clock's time, the clock's counter plus
 * one. A counter that would pass its highest moves the time on by a millisecond instead. So the
 * stamp is later than everything the node has seen, whatever its wall clock says.
 *
 * @param clock - The node's clock: the latest stamp it has issued or merged.
 * @param time - The wall clock as a stamp's time. What to do with a clock out of range is decided
 *   where it's read (see `stamp.sanitizeTime`).
 * @param node - The node that makes the action.
 * @returns The stamp, or undefined when the clock is already at the latest stamp there is, at the
 *   end of the year 2286 with the highest counter: no later stamp exists, so the action can't be
 *   saved. Only a broken or hostile device brings a clock there, and the caller tells the person
 *   their clock is wrong. (Undefined, as in stamp.ts: a problem as text couldn't be told apart from
 *   a stamp.)
 */
export function issueNext(
  clock: stamp.Stamp,
  time: stamp.Time,
  node: stamp.NodeId,
): Result<stamp.Stamp, undefined> {
  const last = stamp.read(clock);
  if (time > last.time) return stamp.create(time, stamp.FIRST_COUNTER, node);

  const counter = stamp.incrementCounter(last.counter);
  if (counter !== "out-of-range") return stamp.create(last.time, counter, node);

  const later = stamp.incrementTime(last.time);
  return later === "out-of-range" ? undefined : stamp.create(later, stamp.FIRST_COUNTER, node);
}

/** The clock once the node has merged something stamped `seen`: the later of the two. */
export const advance = (clock: stamp.Stamp, seen: stamp.Stamp): stamp.Stamp =>
  stamp.compare(seen, clock) > 0 ? seen : clock;
