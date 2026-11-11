import { createSignal } from "solid-js";

import type { ActivityId } from "../plan/id.ts";

// The activity whose placed time a pointer drag is changing: a block of it resized, or a new one
// dragged in from the Activities list. Its progress indicator and the week summary's turn wavy
// meanwhile (see "Wavy progress while resizing" in docs/spec/design.md). The drags set it and the
// bars read it, from different places, so it's app-wide state: a global, as Solid's cheatsheet
// advises.
const [current, setCurrent] = createSignal<ActivityId>();

export { current };

/** A drag starts changing the placed time of the activity `id`. */
export function start(id: ActivityId): void {
  setCurrent(id);
}

/** The drag is over: its bars flatten. */
export function stop(): void {
  setCurrent(undefined);
}
