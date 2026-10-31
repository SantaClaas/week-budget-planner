import type { JSX } from "@solidjs/web";
import { createEffect, onSettled, Show } from "solid-js";

import { current, dismiss, type Snackbar as SnackbarState } from "./index.ts";

/** How long a snackbar stays, as in the prototype. Material asks for 4 to 10 seconds. */
const DURATION_MILLISECONDS = 7000;

/**
 * The snackbar on screen, as a manual popover in the top layer, so it floats above everything and
 * nothing on the page closes it. Its text is read through the live region (see
 * src/announcement/), so the snackbar itself isn't one. It comes last in the page, so Tab reaches
 * its action after everything else.
 */
export function Snackbar(): JSX.Element {
  createEffect(current, (snackbar) => {
    const isTimed = snackbar !== undefined && snackbar.isLasting !== true;
    const timer = isTimed
      ? setTimeout(() => {
          dismiss(snackbar);
        }, DURATION_MILLISECONDS)
      : undefined;
    return () => {
      clearTimeout(timer);
    };
  });

  return (
    <Show when={current()} keyed>
      {(snackbar) => <Surface snackbar={snackbar} />}
    </Show>
  );
}

/** One snackbar's surface, shown in the top layer once it's in the page. */
function Surface(props: { snackbar: SnackbarState }): JSX.Element {
  let element: HTMLDivElement | undefined;
  onSettled(() => {
    element?.showPopover();
  });
  return (
    <div
      class="snackbar"
      popover="manual"
      ref={(created) => {
        element = created;
      }}
    >
      <p id="snackbar-message" class="body-medium">
        {props.snackbar.message}
      </p>
      <Show when={props.snackbar.action}>
        {(action) => (
          <button
            type="button"
            class="button"
            aria-describedby="snackbar-message"
            onClick={() => {
              dismiss(props.snackbar);
              action().run();
            }}
          >
            {action().label}
          </button>
        )}
      </Show>
    </div>
  );
}
