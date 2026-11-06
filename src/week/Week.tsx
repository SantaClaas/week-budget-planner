import type { JSX } from "@solidjs/web";
import { createEffect, flush, For, Show, untrack } from "solid-js";

import { announce } from "../announcement/index.ts";
import { Icon } from "../icons/Icon.tsx";
import { findColor } from "../plan/activity/look.ts";
import type { Block } from "../plan/block/index.ts";
import * as list from "../plan/block/list.ts";
import type { BlockId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { SLOT, type DayIndex } from "../plan/time.ts";
import { changeLength, moveBy, moveDays } from "../plan/week.ts";
import type { Planner } from "../planner/index.ts";
import { isClickAfterDrag, startDrag } from "./drag-controller.ts";
import type { Grip } from "./drag.ts";
import {
  announceChange,
  findOpeningHour,
  layoutWeek,
  listHours,
  type DrawnBlock,
  type DrawnDay,
  type TimeText,
} from "./layout.ts";
import * as selection from "./selection.ts";

/** Text pieces, each one with a `datetime` value in a `<time>` element. */
function Times(properties: { pieces: TimeText[] }): JSX.Element {
  return (
    <For each={properties.pieces}>
      {(piece) => (
        <Show when={piece.datetime} fallback={piece.text}>
          {(datetime) => <time datetime={datetime()}>{piece.text}</time>}
        </Show>
      )}
    </For>
  );
}

/** The id of a block's button, so focus can find it again after a change redraws it. */
const createBlockButtonId = (id: BlockId): string => `block-${id}`;

/** Takes focus to the block's button, or to the week when the block has none any more. */
function focusBlock(scroller: Element | null, id: BlockId | undefined): void {
  flush();
  const button =
    id === undefined ? null : document.querySelector(`#${CSS.escape(createBlockButtonId(id))}`);
  const target = button ?? scroller;
  if (target instanceof HTMLElement) target.focus();
}

/**
 * Removes the block, says so, and takes focus to the next block in Tab order, or the one before,
 * or else the week, since the focused button goes with the block.
 */
function removeBlock(planner: Planner, drawn: DrawnBlock, scroller: Element | null): void {
  const buttons = [...(scroller?.querySelectorAll(".block-button") ?? [])].map(
    (button) => button.id,
  );
  const index = buttons.indexOf(createBlockButtonId(drawn.block.id));
  const next = buttons[index + 1] ?? buttons[index - 1];
  selection.clear();
  planner.change((plan) => list.remove(plan, drawn.block.id));
  announce(announceChange("removed", drawn.block, drawn.activity));
  flush();
  const target = next === undefined ? null : document.querySelector(`#${CSS.escape(next)}`);
  (target instanceof HTMLElement
    ? target
    : scroller instanceof HTMLElement
      ? scroller
      : null
  )?.focus();
}

/**
 * The keys on a focused block (see The week in docs/spec/accessibility.md): Up and Down move it 15
 * minutes, across midnight and around the week; with Shift they change its length; Left and Right
 * change the day; Delete or Backspace removes it; Escape deselects it. Focus stays on the block,
 * and the live region says where it is now.
 */
function handleKey(event: KeyboardEvent, drawn: DrawnBlock, planner: Planner): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const scroller =
    event.currentTarget instanceof Element ? event.currentTarget.closest(".week-scroller") : null;
  const { block } = drawn;
  let changed: { block: Block; change: "moved" | "resized" };
  switch (event.key) {
    case "ArrowUp":
      changed = event.shiftKey
        ? { block: changeLength(block, -SLOT), change: "resized" }
        : { block: moveBy(block, -SLOT), change: "moved" };
      break;
    case "ArrowDown":
      changed = event.shiftKey
        ? { block: changeLength(block, SLOT), change: "resized" }
        : { block: moveBy(block, SLOT), change: "moved" };
      break;
    case "ArrowLeft":
      changed = { block: moveDays(block, -1), change: "moved" };
      break;
    case "ArrowRight":
      changed = { block: moveDays(block, 1), change: "moved" };
      break;
    case "Delete":
    case "Backspace":
      event.preventDefault();
      removeBlock(planner, drawn, scroller);
      return;
    case "Escape":
      selection.clear();
      return;
    default:
      return;
  }
  event.preventDefault();
  const isUnchanged =
    changed.block.day === block.day &&
    changed.block.start === block.start &&
    changed.block.length === block.length;
  if (isUnchanged) return;
  planner.change((plan) => list.update(plan, changed.block));
  announce(announceChange(changed.change, changed.block, drawn.activity));
  // A move to another day draws the block in that day's list, as a new button.
  focusBlock(scroller, block.id);
}

/** What a press took hold of: an edge's handle, or the block's body. */
function readGrip(target: Element): Grip {
  const handle = target.closest("[data-edge]");
  const edge = handle instanceof HTMLElement ? handle.dataset["edge"] : undefined;
  if (edge === "top" || edge === "bottom") return edge;
  return "body";
}

/**
 * A press on a block selects it and can start a move or, on a handle, a resize. On touch, only a
 * selected block can be dragged, so the first tap selects and the week stays scrollable.
 */
function pressBlock(event: PointerEvent, drawn: DrawnBlock, planner: Planner): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!(event.target instanceof Element) || event.target.closest(".remove") !== null) return;
  const isSelected = selection.current() === drawn.block.id;
  if (event.pointerType === "touch" && !isSelected) return;
  const scroller = event.target.closest(".week-scroller");
  if (!(scroller instanceof HTMLElement)) return;
  selection.select(drawn.block.id);
  startDrag(event, {
    part: { block: drawn.block, kind: drawn.part },
    grip: readGrip(event.target),
    planner,
    scroller,
    onDone: (isDragged) => {
      if (isDragged) focusBlock(scroller, drawn.block.id);
    },
  });
}

/**
 * One block, or one part of an overnight block. The block's first (or only) part holds its button,
 * which is what has focus, is pressed while selected and is named for screen readers; what's drawn
 * is hidden from them, so nothing is read twice (see The week in docs/spec/accessibility.md). The
 * handles and the remove button show on hover and while the block is selected.
 */
function BlockPartItem(properties: { block: DrawnBlock; planner: Planner }): JSX.Element {
  const id = (): BlockId => properties.block.block.id;
  const isSelected = (): boolean => selection.current() === id();
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- the pointer's path: a press anywhere on a part, also the second part of an overnight block, which has no button. The keyboard's path is the block's button.
    <li
      class="block"
      data-color={findColor(properties.block.activity.hue).key}
      data-length={properties.block.size === "regular" ? undefined : properties.block.size}
      data-part={properties.block.part === "only" ? undefined : properties.block.part}
      style={{
        "--start": properties.block.start,
        "--length": properties.block.length,
        "--lane": properties.block.lane.index,
        "--lanes": properties.block.lane.count,
        "--name-lines": properties.block.nameLines,
        "--activity-shape": `var(--shape-${properties.block.activity.shape})`,
      }}
      onPointerDown={(event) => {
        pressBlock(event, properties.block, properties.planner);
      }}
      onClick={() => {
        if (!isClickAfterDrag()) selection.select(id());
      }}
    >
      <Show
        when={properties.block.part !== "second"}
        fallback={<span class="visually-hidden">{properties.block.spoken}</span>}
      >
        <button
          type="button"
          class="block-button"
          id={createBlockButtonId(id())}
          aria-pressed={isSelected() ? "true" : "false"}
          aria-describedby="block-keys"
          onFocus={() => {
            selection.select(id());
          }}
          onKeyDown={(event) => {
            handleKey(event, properties.block, properties.planner);
          }}
        >
          <span class="visually-hidden">{properties.block.spoken}</span>
        </button>
      </Show>
      <span class="emblem" aria-hidden="true" />
      <span class="name" aria-hidden="true">
        {properties.block.activity.name}
      </span>
      <span class="time" aria-hidden="true">
        <Times pieces={properties.block.time} />
      </span>
      {/* A 15-minute block has no top handle, and each part only the edge it can move. */}
      <Show when={properties.block.part !== "second" && properties.block.size !== "tiny"}>
        <span class="handle" data-edge="top" aria-hidden="true" />
      </Show>
      <Show when={properties.block.part !== "first"}>
        <span class="handle" data-edge="bottom" aria-hidden="true" />
      </Show>
      {/* Out of Tab order: Delete on the block does the same. */}
      <Show when={properties.block.part !== "second"}>
        <button
          type="button"
          class="remove"
          tabindex="-1"
          onClick={(event) => {
            event.stopPropagation();
            removeBlock(
              properties.planner,
              properties.block,
              event.currentTarget.closest(".week-scroller"),
            );
          }}
        >
          <Icon name="close" size={18} />
          <span class="visually-hidden">Remove block</span>
        </button>
      </Show>
    </li>
  );
}

function Day(properties: { day: DrawnDay; planner: Planner }): JSX.Element {
  return (
    <li class="day" data-weekend={properties.day.isWeekend}>
      <h2 class="day-header" aria-current={properties.day.isToday ? "date" : undefined}>
        <span class="day-name" aria-hidden="true">
          {properties.day.name}
        </span>
        <span class="day-total" aria-hidden="true">
          <Times pieces={properties.day.total} />
        </span>
        <span class="visually-hidden">{properties.day.spoken}</span>
      </h2>
      <ol class="day-column">
        <For each={properties.day.blocks} keyed={(block) => block.key}>
          {(block) => <BlockPartItem block={block()} planner={properties.planner} />}
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
export function Week(properties: {
  plan: Plan;
  planner: Planner;
  today: DayIndex | undefined;
}): JSX.Element {
  let scroller: HTMLElement | undefined;
  const days = () => layoutWeek(properties.plan, properties.today);

  createEffect(
    () => [properties.plan.dayStart, properties.plan.dayEnd],
    () => {
      const column = scroller?.querySelector<HTMLElement>(".day-column");
      if (scroller === undefined || column === null || column === undefined) return;
      const hour = untrack(() => findOpeningHour(properties.plan));
      // A quarter hour above it, so the hour's label, centered on its line, isn't half hidden
      // under the sticky day headers.
      scroller.scrollTop = (column.offsetHeight * (hour * 4 - 1)) / 96;
    },
  );

  return (
    // The region scrolls, so it takes focus: it's how the keyboard scrolls the week, besides moving
    // between blocks. A click on it away from the blocks deselects.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- the pointer's way to deselect; Escape on the block is the keyboard's.
    <section
      class="week-scroller"
      aria-label="Week"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region has to be focusable, or keyboard users can't scroll it.
      tabindex="0"
      ref={(element) => {
        scroller = element;
      }}
      onClick={(event) => {
        const isOnBlock =
          event.target instanceof Element && event.target.closest(".block") !== null;
        if (!isOnBlock && !isClickAfterDrag()) selection.clear();
      }}
    >
      <p id="block-keys" hidden>
        Arrow keys move the block, Shift and the arrow keys change its length, Delete removes it.
      </p>
      <div
        class="week"
        style={{ "--day-start": properties.plan.dayStart, "--day-end": properties.plan.dayEnd }}
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
            {(day) => <Day day={day()} planner={properties.planner} />}
          </For>
        </ol>
      </div>
    </section>
  );
}
