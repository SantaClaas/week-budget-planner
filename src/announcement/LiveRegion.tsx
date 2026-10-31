import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { current } from "./index.ts";

/**
 * The page's live regions, outside <main> so they outlive a change of page. Each announcement is a
 * new element in its region, which screen readers read as an addition, even when the text repeats.
 */
export function LiveRegion(): JSX.Element {
  return (
    <>
      {/* An output is a polite live region, role="status". */}
      <output class="visually-hidden">
        <Show when={current()?.urgency === "polite" ? current() : undefined} keyed>
          {(announcement) => <p>{announcement.text}</p>}
        </Show>
      </output>
      <div role="alert" class="visually-hidden">
        <Show when={current()?.urgency === "assertive" ? current() : undefined} keyed>
          {(announcement) => <p>{announcement.text}</p>}
        </Show>
      </div>
    </>
  );
}
