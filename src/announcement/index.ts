import { createSignal } from "solid-js";

/**
 * Something said to screen readers through the page's one live region (see Accessibility in
 * docs/spec/design.md): "polite" waits for a pause, "assertive" interrupts, for a failed save.
 */
export type Announcement = { text: string; urgency: "polite" | "assertive" };

// One live region for the whole app, so it's a global, as Solid's cheatsheet advises for app-wide
// state. A new object each time, so the same text said twice is rendered, and read, twice.
const [current, setCurrent] = createSignal<Announcement>();

export { current };

/** Reads the text out once, without moving focus. */
export function announce(text: string, urgency: Announcement["urgency"] = "polite"): void {
  setCurrent({ text, urgency });
}
