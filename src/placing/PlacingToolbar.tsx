import type { JSX } from "@solidjs/web";
import { flush, Show } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { Activity } from "../plan/activity/index.ts";
import { findColor } from "../plan/activity/look.ts";
import { pickDefaultLength } from "../plan/block/length.ts";
import { calculateWeeklyBudget, sumPlacedByActivity } from "../plan/budget.ts";
import { formatClock, formatLength } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import { findFirstFreeSlot } from "../plan/slot.ts";
import type { Planner } from "../planner/index.ts";
import * as snackbar from "../snackbar/index.ts";
import * as placing from "./index.ts";

/** The toolbar's id, so focus can go to it when placing starts from the Activities page. */
export const PLACING_TOOLBAR_ID = "placing-toolbar";

/**
 * "Use first free slot": adds a block at the earliest gap in the day hours that fits the default
 * length, and shows it, or says there's none.
 */
function useFirstFreeSlot(plan: Plan, planner: Planner, activity: Activity): void {
  const length = pickDefaultLength(activity, plan.blocks);
  const slot = findFirstFreeSlot(plan, activity, length);
  if (slot === undefined) {
    const from = formatClock(plan.dayStart * 60);
    const to = formatClock(plan.dayEnd * 60);
    snackbar.show({ message: `No free ${formatLength(length)} slot between ${from} and ${to}.` });
    return;
  }
  const block = placing.addBlock(planner, activity, slot);
  if (block === undefined) return;
  flush();
  document
    .querySelector(`[data-block="${CSS.escape(block.id)}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * The floating toolbar while an activity is placing (see Adding blocks in
 * docs/spec/interactions.md): what's placing and at what length, what's left of it, "Use first
 * free slot" and "Done". It says "Click a time slot" with a mouse and "Tap a slot" on touch. On
 * phones it keeps to one line with the design canvas's shorter labels: no length, "First free
 * slot", and a close icon named "Stop placing" for Done.
 */
export function PlacingToolbar(properties: { plan: Plan; planner: Planner }): JSX.Element {
  const activity = (): Activity | undefined =>
    properties.plan.activities.find((each) => each.id === placing.current());
  return (
    <Show when={activity()}>
      {(placed) => {
        const left = (): number =>
          calculateWeeklyBudget(placed()) -
          (sumPlacedByActivity(properties.plan.blocks).get(placed().id) ?? 0);
        const length = (): number => pickDefaultLength(placed(), properties.plan.blocks);
        return (
          <section
            id={PLACING_TOOLBAR_ID}
            class="toolbar placing-toolbar"
            data-variant="vibrant"
            data-color={findColor(placed().hue).key}
            style={{ "--activity-shape": `var(--shape-${placed().shape})` }}
            aria-labelledby="placing-title"
            tabindex="-1"
          >
            <span class="emblem" aria-hidden="true" />
            <p class="text">
              <span id="placing-title" class="label-large emphasized">
                Placing {placed().name}
                <span class="for-wide-window"> · {formatLength(length())}</span>
              </span>
              <span class="body-small">
                <span class="for-fine-pointer">Click a time slot</span>
                <span class="for-coarse-pointer">Tap a slot</span>
                {left() > 0 ? ` · ${formatLength(left())} left to place` : ""}
              </span>
            </p>
            <button
              type="button"
              class="button"
              data-size="extra-small"
              data-variant="tonal"
              onClick={() => {
                useFirstFreeSlot(properties.plan, properties.planner, placed());
              }}
            >
              <span class="for-wide-window">Use first free slot</span>
              <span class="for-narrow-window">First free slot</span>
            </button>
            <button
              type="button"
              class="button for-wide-window"
              data-size="extra-small"
              onClick={placing.stop}
            >
              Done
            </button>
            <button type="button" class="icon-button for-narrow-window" onClick={placing.stop}>
              <Icon name="close" />
              <span class="visually-hidden">Stop placing</span>
            </button>
          </section>
        );
      }}
    </Show>
  );
}
