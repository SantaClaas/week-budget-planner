// Nodes for the tests: each with its id, its clock and its rows, as the leader tab will hold them.
// A node acts as the app will: it reads the plan from its rows, makes the plan after, and saves a
// change with one stamp from its clock. What it receives goes through JSON and the strict check, as
// it will over the network.
import type { Plan } from "../plan/index.ts";
import { make } from "./change.ts";
import { parse } from "./check.ts";
import { advance, next } from "./clock.ts";
import { findLatestStamp, merge, readPlan, type Change, type Rows } from "./index.ts";
import { LOWEST, create, parseNodeId, type NodeId, type Stamp } from "./stamp.ts";

/** The value, or a throw when the test data doesn't have it. */
export function required<Value>(value: Value | null | undefined, what: string): Value {
  if (value === undefined || value === null) throw new Error(`The test data has no ${what}.`);

  return value;
}

export function createNodeId(text: string): NodeId {
  const id = parseNodeId(text);
  if (id === undefined) throw new Error(`The test data has an invalid node id: ${text}.`);

  return id;
}

/** The stamp of `time` and `counter` by the node `node`. */
export const createStamp = (time: number, counter: number, node: string): Stamp =>
  create(time, counter, createNodeId(node));

export type Node = { readonly id: NodeId; clock: Stamp; rows: Rows };

export const createNode = (name: string, rows: Rows): Node => ({
  id: createNodeId(name),
  clock: LOWEST,
  rows,
});

/**
 * Makes `node` do one action at the wall-clock time `now` (milliseconds): `perform` turns the plan
 * it shows into the plan after. Gives back the change it saved, for the other nodes.
 */
export function act(node: Node, now: number, perform: (plan: Plan) => Plan): Change {
  const before = readPlan(node.rows);
  const after = perform(before);
  const stamp = next(node.clock, Temporal.Instant.fromEpochMilliseconds(now), node.id);
  const made = make(node.rows, before, after, stamp);
  node.clock = stamp;
  node.rows = made.rows;
  return made.change;
}

/** A change as another node gets it: sent as JSON, and checked strictly. */
export function send(change: Change): Change {
  const received = parse(JSON.parse(JSON.stringify(change)));
  if (typeof received === "string") throw new Error(`A change was refused: ${received}.`);

  return received;
}

/** Makes `node` merge a change it received, and moves its clock on. */
export function receive(node: Node, change: Change): void {
  const checked = send(change);
  node.rows = merge(node.rows, checked);
  node.clock = advance(node.clock, findLatestStamp(checked));
}
