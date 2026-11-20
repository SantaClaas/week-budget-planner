// This browser's node id, made at the edge: it's random, so the code that needs one takes it as an
// argument (see "A pure core, with side effects at the edges" in docs/guidelines/principles.md).
import { customAlphabet } from "nanoid";

import { parseNodeId, type NodeId } from "../merge/stamp.ts";

/** Twelve letters and digits, the characters a node id may hold (see merge/stamp.ts). */
const createNodeText = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);

/** A new node id for this browser: on its first save, and after an import. */
export function createRandomNodeId(): NodeId {
  const id = parseNodeId(createNodeText());
  if (id === undefined) throw new Error("A new node id had characters a node id can't hold.");

  return id;
}
