import { createSignal } from "solid-js";

import type { ActivityId } from "../plan/id.ts";

/**
 * Which activity form is open: the new-activity form, the form of the activity being edited, or
 * none. One at a time, so opening one closes the other. With no activities at all, the
 * new-activity form shows anyway (see Changes from the prototype in docs/spec/).
 */
type Edit = { type: "new" } | { type: "edit"; id: ActivityId } | undefined;

// The rail's "New activity" button opens the form in the Activities list, which is elsewhere in
// the page, so this is app-wide state: a global, as Solid's cheatsheet advises.
const [current, setCurrent] = createSignal<Edit>();

export { current };

/** Opens the new-activity form at the top of the list. */
export function openNew(): void {
  setCurrent({ type: "new" });
}

/** Opens the form of the activity `id` in its place in the list. */
export function open(id: ActivityId): void {
  setCurrent({ type: "edit", id });
}

/** Closes whichever form is open. */
export function close(): void {
  setCurrent(undefined);
}
