import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Icon } from "../icons/Icon.tsx";

/**
 * The note over a week without any blocks (see Layout in docs/spec/layout.md): what to do first,
 * for the screen and the pointer the user has. Without activities, it says to add one, on the
 * left on wide screens or on the Activities page on phones; with them, how to place one. It sits
 * over the grid without taking clicks or taps, so every empty slot can still be picked, and it
 * isn't focusable: screen readers read it before the days.
 */
export function EmptyWeek(properties: { hasActivities: boolean }): JSX.Element {
  return (
    <section class="empty-week" aria-labelledby="empty-week-title">
      <Icon name="calendar_add_on" />
      <h2 id="empty-week-title" class="title-medium">
        Your week is empty
      </h2>
      <Show
        when={properties.hasActivities}
        fallback={
          <p class="body-medium">
            Add an activity <span class="for-wide-window">on the left</span>
            <span class="for-narrow-window">on the Activities page</span>. Then{" "}
            <span class="for-fine-pointer">drag it here, or click any empty slot</span>
            <span class="for-coarse-pointer">tap it to place it, or tap any empty slot</span> to add
            a block.
          </p>
        }
      >
        <p class="body-medium">
          <span class="for-fine-pointer">Drag an activity here, or click any empty slot</span>
          <span class="for-coarse-pointer">
            Tap an activity to place it, or tap any empty slot
          </span>{" "}
          to add a block.
        </p>
      </Show>
    </section>
  );
}
