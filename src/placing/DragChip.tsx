import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { findColor } from "../plan/activity/look.ts";
import { formatLength } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import * as placing from "./index.ts";

/**
 * The chip that follows the pointer while an activity is dragged from the list: its emblem, name
 * and the length the block would get. It only shows the drag, so it's hidden from screen readers;
 * the keyboard's way to add a block is placing.
 */
export function DragChip(properties: { plan: Plan }): JSX.Element {
  const shown = () => {
    const chip = placing.chip();
    const activity = properties.plan.activities.find((each) => each.id === chip?.activityId);
    return chip === undefined || activity === undefined ? undefined : { chip, activity };
  };
  return (
    <Show when={shown()}>
      {(dragged) => (
        <div
          class="drag-chip"
          aria-hidden="true"
          data-color={findColor(dragged().activity.hue).key}
          style={{
            "--activity-shape": `var(--shape-${dragged().activity.shape})`,
            translate: `${String(dragged().chip.x)}px ${String(dragged().chip.y)}px`,
          }}
        >
          <span class="emblem" />
          {dragged().activity.name} · {formatLength(dragged().chip.length)}
        </div>
      )}
    </Show>
  );
}
