import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import * as list from "../plan/block/list.ts";
import { formatClock, formatClockRange, formatCount } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import { sanitizeDayEnd, sanitizeDayStart } from "../plan/time.ts";
import type { Planner } from "../planner/index.ts";
import * as snackbar from "../snackbar/index.ts";
import * as selection from "./selection.ts";

/** The day hours' menu, which its button opens. */
const DAY_HOURS_ID = "day-hours";

/** Where the day hours may start (00:00 to 12:00) and end (13:00 to 24:00), in hours. */
const STARTS = Array.from({ length: 13 }, (_, hour) => hour);
const ENDS = Array.from({ length: 12 }, (_, index) => index + 13);

/** How the tools look: outlined buttons above the week, or list items in Settings › Week. */
type Variant = "button" | "list-item";

/** "07:00–22:00". */
const formatDayHours = (plan: Plan): string =>
  formatClockRange(plan.dayStart * 60, plan.dayEnd * 60);

/** One hour's choice in a day-hours select. */
function HourOptions(properties: { hours: number[]; selected: number }): JSX.Element {
  return (
    <For each={properties.hours}>
      {(hour) => (
        <option value={hour} selected={hour === properties.selected}>
          {formatClock(hour * 60)}
        </option>
      )}
    </For>
  );
}

/**
 * Day hours (see the glossary): a button that opens a menu with the two hour selects. The week
 * opens scrolled to them again when they change.
 */
export function DayHours(properties: {
  plan: Plan;
  planner: Planner;
  variant: Variant;
}): JSX.Element {
  const change = (update: (plan: Plan, hour: number) => Plan) => (event: Event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const hour = Number(event.target.value);
    properties.planner.change((plan) => update(plan, hour));
  };
  return (
    <>
      {properties.variant === "button" ? (
        <button
          type="button"
          class="button day-hours-button"
          data-variant="outlined"
          popovertarget={DAY_HOURS_ID}
        >
          <Icon name="schedule" size={18} />
          Day hours · {formatDayHours(properties.plan)}
        </button>
      ) : (
        <button
          type="button"
          class="list-item day-hours-button"
          popovertarget={DAY_HOURS_ID}
          aria-labelledby={`${DAY_HOURS_ID}-title`}
          aria-describedby={`${DAY_HOURS_ID}-range`}
        >
          <Icon name="schedule" />
          <span class="grow">
            <span id={`${DAY_HOURS_ID}-title`} class="body-large">
              Day hours
            </span>
            <span id={`${DAY_HOURS_ID}-range`} class="body-medium muted">
              {formatDayHours(properties.plan)}
            </span>
          </span>
          <Icon name="chevron_right" />
        </button>
      )}
      <section
        id={DAY_HOURS_ID}
        class="menu day-hours-menu"
        popover="auto"
        aria-labelledby={`${DAY_HOURS_ID}-heading`}
      >
        <h2 id={`${DAY_HOURS_ID}-heading`} class="label-medium muted">
          Day hours
        </h2>
        <p class="body-small muted">
          The week opens at these hours, and "First free slot" looks only inside them.
        </p>
        <label class="hour-select">
          <span class="label-large">Start</span>
          <select
            onChange={change((plan, hour) => ({ ...plan, dayStart: sanitizeDayStart(hour) }))}
          >
            <HourOptions hours={STARTS} selected={properties.plan.dayStart} />
          </select>
        </label>
        <label class="hour-select">
          <span class="label-large">End</span>
          <select onChange={change((plan, hour) => ({ ...plan, dayEnd: sanitizeDayEnd(hour) }))}>
            <HourOptions hours={ENDS} selected={properties.plan.dayEnd} />
          </select>
        </label>
      </section>
    </>
  );
}

/** Removes every block, keeps the activities, and says so in a snackbar with Undo. */
function clearWeek(planner: Planner): void {
  const count = planner.plan().blocks.length;
  if (count === 0) return;
  selection.clear();
  planner.change(list.clear);
  snackbar.show({
    message: `Removed ${formatCount(count, { one: "block", other: "blocks" })} from the week.`,
    action: {
      label: "Undo",
      run: () => {
        planner.undo();
      },
    },
  });
}

/** Clear week: removes every block and keeps the activities. Disabled while there are none. */
export function ClearWeek(properties: {
  plan: Plan;
  planner: Planner;
  variant: Variant;
}): JSX.Element {
  const isEmpty = (): boolean => properties.plan.blocks.length === 0;
  const clear = (): void => {
    clearWeek(properties.planner);
  };
  return properties.variant === "button" ? (
    <button
      type="button"
      class="button"
      data-variant="outlined"
      disabled={isEmpty()}
      onClick={clear}
    >
      <Icon name="delete_sweep" size={18} />
      Clear week
    </button>
  ) : (
    <button
      type="button"
      class="list-item"
      disabled={isEmpty()}
      aria-labelledby="clear-week-title"
      aria-describedby="clear-week-text"
      onClick={clear}
    >
      <Icon name="delete_sweep" />
      <span class="grow">
        <span id="clear-week-title" class="body-large">
          Clear week
        </span>
        <span id="clear-week-text" class="body-medium muted">
          Removes all blocks, keeps activities
        </span>
      </span>
    </button>
  );
}
