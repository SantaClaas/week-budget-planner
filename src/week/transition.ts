import { flush } from "solid-js";

/**
 * Animates a change to the blocks (see Motion in docs/spec/design.md): `update` runs inside a View
 * Transition scoped to the week, so blocks glide to where they land, and those added or removed
 * fade and scale in or out, clipped to the week while the rest of the page stays usable. Where
 * element-scoped transitions are missing, or the week isn't on the page, `update` runs at once,
 * without the animation.
 *
 * `update` runs later, once the browser has captured the week as it was, so everything that
 * belongs to the change goes inside it: reading the plan, changing it, announcing it and moving
 * focus. It reads the plan then, not before, so a key pressed again before the last change shows
 * builds on that change instead of undoing it.
 */
export function animate(update: () => void): void {
  const scope = document.querySelector(".week-scroller");
  if (scope?.startViewTransition === undefined) {
    update();
    return;
  }
  const transition = scope.startViewTransition(() => {
    update();
    // Solid applies changes in a microtask; the new state has to be on the page when this returns.
    flush();
  });
  // A change that starts before the last one finished skips the last one's animation, which
  // rejects its `ready`. The change itself still runs.
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch((error: unknown) => {
    // A mistake in `update` would otherwise only reject a promise nobody looks at.
    reportError(error);
  });
}
