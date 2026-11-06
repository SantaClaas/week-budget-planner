import { createSignal } from "solid-js";

import type { BlockId } from "../plan/id.ts";

// The one selected block of the week (see Editing blocks in docs/spec/interactions.md). The drag
// controller and the keys both select, from different places, so it's app-wide state: a global,
// as Solid's cheatsheet advises.
const [current, setCurrent] = createSignal<BlockId>();

export { current };

/** Selects the block `id`, which shows its handles and its remove button. */
export function select(id: BlockId): void {
  setCurrent(id);
}

/** Selects no block. */
export function clear(): void {
  setCurrent(undefined);
}
