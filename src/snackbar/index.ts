import { createSignal } from "solid-js";

import { announce, type Announcement } from "../announcement/index.ts";

/**
 * A short message at the bottom of the screen, with at most one action (see Interactions and
 * Accessibility in docs/spec/). One shows at a time: a new one replaces the one on screen.
 * - `action`: a text button, such as Undo or Reload.
 * - `isLasting`: stays until its action runs, for a message the user has to act on.
 */
export type Snackbar = {
  message: string;
  action?: { label: string; run(): void };
  isLasting?: boolean;
  urgency?: Announcement["urgency"];
};

// The app's one snackbar, so it's a global, as Solid's cheatsheet advises for app-wide state.
const [current, setCurrent] = createSignal<Snackbar>();

export { current };

/** Shows the snackbar, and says its message through the live region. */
export function show(snackbar: Snackbar): void {
  setCurrent(snackbar);
  announce(snackbar.message, snackbar.urgency);
}

/** Hides `snackbar` if it's still the one on screen. */
export function dismiss(snackbar: Snackbar): void {
  if (current() === snackbar) setCurrent(undefined);
}
