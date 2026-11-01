import type { JSX } from "@solidjs/web";
import { createEffect, For, Show, untrack } from "solid-js";

import { findColor } from "../plan/activity/look.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex } from "../plan/time.ts";
import {
  findOpeningHour,
  layoutWeek,
  listHours,
  type DrawnBlock,
  type DrawnDay,
  type TimeText,
} from "./layout.ts";

/** Text pieces, each one with a `datetime` value in a `<time>` element. */
function Times(props: { pieces: TimeText[] }): JSX.Element {
  return (
    <For each={props.pieces}>
      {(piece) => (
        <Show when={piece.datetime} fallback={piece.text}>
          {(datetime) => <time datetime={datetime()}>{piece.text}</time>}
        </Show>
      )}
    </For>
  );
}

/**
 * One block, or one part of an overnight block. What's drawn is hidden from screen readers, which
 * read the spelled-out name instead (see The week in docs/spec/accessibility.md).
 */
function Block(props: { block: DrawnBlock }): JSX.Element {
  return (
    <li
      class="block"
      data-color={findColor(props.block.activity.hue).key}
      data-length={props.block.size === "regular" ? undefined : props.block.size}
      data-part={props.block.part === "only" ? undefined : props.block.part}
      style={{
        "--start": props.block.start,
        "--length": props.block.length,
        "--lane": props.block.lane.index,
        "--lanes": props.block.lane.count,
        "--name-lines": props.block.nameLines,
        "--activity-shape": `var(--shape-${props.block.activity.shape})`,
      }}
    >
      <span class="visually-hidden">{props.block.spoken}</span>
      <span class="name" aria-hidden="true">
        {props.block.activity.name}
      </span>
      <span class="time" aria-hidden="true">
        <Times pieces={props.block.time} />
      </span>
    </li>
  );
}

function Day(props: { day: DrawnDay }): JSX.Element {
  return (
    <li class="day" data-weekend={props.day.isWeekend}>
      <h2 class="day-header" aria-current={props.day.isToday ? "date" : undefined}>
        <span class="day-name" aria-hidden="true">
          {props.day.name}
        </span>
        <span class="day-total" aria-hidden="true">
          <Times pieces={props.day.total} />
        </span>
        <span class="visually-hidden">{props.day.spoken}</span>
      </h2>
      <ol class="day-column">
        <For each={props.day.blocks} keyed={(block) => block.key}>
          {(block) => <Block block={block()} />}
        </For>
      </ol>
    </li>
  );
}

/**
 * The week: a gutter of hours and seven days side by side, all 24 hours tall, scrolling inside its
 * own region with the day headers and the gutter sticky (see docs/spec/grid-geometry.md). It opens
 * scrolled to the day hours, and again when they change, never while the user works.
 */
export function Week(props: { plan: Plan; today: DayIndex | undefined }): JSX.Element {
  let scroller: HTMLElement | undefined;
  const days = () => layoutWeek(props.plan, props.today);

  createEffect(
    () => [props.plan.dayStart, props.plan.dayEnd],
    () => {
      const column = scroller?.querySelector<HTMLElement>(".day-column");
      if (scroller === undefined || column === null || column === undefined) return;
      const hour = untrack(() => findOpeningHour(props.plan));
      // A quarter hour above it, so the hour's label, centered on its line, isn't half hidden
      // under the sticky day headers.
      scroller.scrollTop = (column.offsetHeight * (hour * 4 - 1)) / 96;
    },
  );

  return (
    // The region scrolls, so it takes focus: until blocks and slots can (later in phase 4), it's
    // how the keyboard scrolls the week.
    <section
      class="week-scroller"
      aria-label="Week"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region has to be focusable, or keyboard users can't scroll it.
      tabindex="0"
      ref={(element) => {
        scroller = element;
      }}
    >
      <div
        class="week"
        style={{ "--day-start": props.plan.dayStart, "--day-end": props.plan.dayEnd }}
      >
        <div class="gutter" aria-hidden="true">
          <For each={listHours()}>
            {(label) => (
              <time datetime={label.datetime} style={{ "--hour-index": label.hour }}>
                {label.text}
              </time>
            )}
          </For>
        </div>
        <ol class="days" aria-label="Days">
          <For each={days()} keyed={(day) => day.index}>
            {(day) => <Day day={day()} />}
          </For>
        </ol>
      </div>
    </section>
  );
}
