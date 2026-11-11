import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, flush, For, Show, untrack } from "solid-js";

import { announce } from "../announcement/index.ts";
import { Icon } from "../icons/Icon.tsx";
import { findColor } from "../plan/activity/look.ts";
import type { Block } from "../plan/block/index.ts";
import * as list from "../plan/block/list.ts";
import type { BlockId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import type { Activity } from "../plan/activity/index.ts";
import { formatClock, formatClockRange, formatWeekday } from "../plan/format.ts";
import { DAY, SLOT, type DayIndex } from "../plan/time.ts";
import { changeLength, moveBy, moveDays } from "../plan/week.ts";
import type { Planner } from "../planner/index.ts";
import { findEmptySlot, moveEmptySlot, type Slot, type SlotMove } from "../plan/slot.ts";
import { findSlot, isClickAfterDrag, startDrag } from "./drag-controller.ts";
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
import { animate } from "./transition.ts";

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

/** Takes focus to the element with the id `id`, once the page shows it, or else to the week. */
function focusOrWeek(scroller: Element | null, id: string | undefined): void {
  flush();
  const element = id === undefined ? null : document.querySelector(`#${CSS.escape(id)}`);
  const target = element ?? scroller;
  if (target instanceof HTMLElement) target.focus();
}

/** Takes focus to the block's button, or to the week when the block has none any more. */
function focusBlock(scroller: Element | null, id: BlockId): void {
  focusOrWeek(scroller, createBlockButtonId(id));
}

/**
 * Removes the block, says so, and takes focus to the next block in Tab order, or the one before,
 * or else the week, since the focused button goes with the block. It's animated, so it runs once
 * the week is captured, and does nothing when the block went in the meantime (a second Delete).
 */
function removeBlock(planner: Planner, drawn: DrawnBlock, scroller: Element | null): void {
  animate(() => {
    const isInPlan = planner.plan().blocks.some((block) => block.id === drawn.block.id);
    if (!isInPlan) return;
    const buttons = [...(scroller?.querySelectorAll(".block-button") ?? [])].map(
      (button) => button.id,
    );
    const index = buttons.indexOf(createBlockButtonId(drawn.block.id));
    const next = buttons[index + 1] ?? buttons[index - 1];
    selection.clear();
    planner.change((plan) => list.remove(plan, drawn.block.id));
    announce(announceChange("removed", drawn.block, drawn.activity));
    focusOrWeek(scroller, next);
  });
}

/** What a key does to a block, or `undefined` for a key that doesn't change it. */
type KeyChange = { change: "moved" | "resized"; apply: (block: Block) => Block };

/** Up and Down move by 15 minutes, with Shift they change the length, Left and Right the day. */
function readKeyChange(event: KeyboardEvent): KeyChange | undefined {
  switch (event.key) {
    case "ArrowUp":
      return event.shiftKey
        ? { change: "resized", apply: (block) => changeLength(block, -SLOT) }
        : { change: "moved", apply: (block) => moveBy(block, -SLOT) };
    case "ArrowDown":
      return event.shiftKey
        ? { change: "resized", apply: (block) => changeLength(block, SLOT) }
        : { change: "moved", apply: (block) => moveBy(block, SLOT) };
    case "ArrowLeft":
      return { change: "moved", apply: (block) => moveDays(block, -1) };
    case "ArrowRight":
      return { change: "moved", apply: (block) => moveDays(block, 1) };
    default:
      return undefined;
  }
}

/**
 * Applies a key's change to the block as the plan has it now, which may already hold the change
 * of the key before, says where it is, and keeps focus on it.
 */
function changeByKey(
  planner: Planner,
  drawn: DrawnBlock,
  keyChange: KeyChange,
  scroller: Element | null,
): void {
  const block = planner.plan().blocks.find((each) => each.id === drawn.block.id);
  if (block === undefined) return;
  const changed = keyChange.apply(block);
  const isUnchanged =
    changed.day === block.day && changed.start === block.start && changed.length === block.length;
  if (isUnchanged) return;
  planner.change((plan) => list.update(plan, changed));
  announce(announceChange(keyChange.change, changed, drawn.activity));
  // A move to another day draws the block in that day's list, as a new button.
  focusBlock(scroller, block.id);
}

/**
 * The keys on a focused block (see The week in docs/spec/accessibility.md): Up and Down move it 15
 * minutes, across midnight and around the week; with Shift they change its length; Left and Right
 * change the day; Delete or Backspace removes it; Escape deselects it. Focus stays on the block,
 * and the live region says where it is now.
 */
function handleKey(event: KeyboardEvent, drawn: DrawnBlock, planner: Planner): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  // A tab on a newer version took over: the plan can be read, not changed, so keys only deselect.
  if (planner.isOutdated() && event.key !== "Escape") return;
  const scroller =
    event.currentTarget instanceof Element ? event.currentTarget.closest(".week-scroller") : null;
  switch (event.key) {
    case "Delete":
    case "Backspace":
      event.preventDefault();
      removeBlock(planner, drawn, scroller);
      return;
    case "Escape":
      selection.clear();
      return;
    default:
      break;
  }
  const keyChange = readKeyChange(event);
  if (keyChange === undefined) return;
  event.preventDefault();
  animate(() => {
    changeByKey(planner, drawn, keyChange, scroller);
  });
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
  if (planner.isOutdated()) return;
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
      data-block={id()}
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
        // Unique on the week, so an animated change tracks each part, also across days.
        "view-transition-name": CSS.escape(
          `block-${id()}${properties.block.part === "second" ? "-continued" : ""}`,
        ),
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
          aria-disabled={properties.planner.isOutdated() ? "true" : undefined}
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
          aria-disabled={properties.planner.isOutdated() ? "true" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (properties.planner.isOutdated()) return;
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

/** Where a new block of `activity` would land, which the week draws as a dashed outline. */
export type WeekPreview = { activity: Activity; day: DayIndex; start: number; length: number };

/** Where a new block would land, as a dashed outline with its time ("10:00–11:30"). */
type DrawnPreview = { color: string; start: number; length: number; time: string };

/** The dashed outline of a new block, which only shows what a click or drop would add. */
function Preview(properties: { preview: DrawnPreview }): JSX.Element {
  return (
    <li
      class="block preview"
      aria-hidden="true"
      data-color={properties.preview.color}
      data-length={properties.preview.length <= 30 ? "short" : undefined}
      style={{
        "--start": properties.preview.start,
        "--length": properties.preview.length,
        "--lane": 0,
        "--lanes": 1,
      }}
    >
      <span class="time">{properties.preview.time}</span>
    </li>
  );
}

function Day(properties: {
  day: DrawnDay;
  planner: Planner;
  preview: DrawnPreview | undefined;
}): JSX.Element {
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
        <Show when={properties.preview}>{(preview) => <Preview preview={preview()} />}</Show>
      </ol>
    </li>
  );
}

/** The focused empty slot's id, so focus can find it again once a move draws it anew. */
const EMPTY_SLOT_ID = "empty-slot";

/** Which way each key moves the empty slot (see The week in docs/spec/accessibility.md). */
const SLOT_MOVES: Partial<Record<string, SlotMove>> = {
  ArrowUp: "earlier",
  ArrowDown: "later",
  ArrowLeft: "day-earlier",
  ArrowRight: "day-later",
  PageUp: "hour-earlier",
  PageDown: "hour-later",
};

/** What picked an empty slot. */
type Picker = "pointer" | "keyboard";

/**
 * The one empty slot in Tab order, after the blocks: a button drawn as the highlighted slot while
 * it has focus or its Add block is open. The arrow and page keys move it past the blocks, and
 * Enter or Space picks it, as a click on the slot does.
 */
function EmptySlot(properties: {
  slot: Slot;
  isAddingBlock: boolean;
  /** A tab on a newer version took over, so picking it would change a plan that can't be saved. */
  isReadOnly: boolean;
  onMove: (slot: Slot) => void;
  onPick: (slot: Slot, picker: Picker) => void;
  blocks: readonly Block[];
}): JSX.Element {
  return (
    <button
      type="button"
      id={EMPTY_SLOT_ID}
      class="slot-highlight"
      aria-expanded={properties.isAddingBlock ? "true" : "false"}
      aria-disabled={properties.isReadOnly ? "true" : undefined}
      style={{ "--day": properties.slot.day, "--start": properties.slot.start }}
      onClick={(event) => {
        // The week's own click handler would pick the slot again, from the pointer's place.
        event.stopPropagation();
        if (properties.isReadOnly) return;
        // A click from Enter or Space has no pointer, and so no click count.
        properties.onPick(properties.slot, event.detail === 0 ? "keyboard" : "pointer");
      }}
      onKeyDown={(event) => {
        const move = SLOT_MOVES[event.key];
        if (move === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
        const next = moveEmptySlot(properties.blocks, properties.slot, move);
        // At the week's ends the key does nothing here, and the page scrolls as usual.
        if (next === undefined) return;
        event.preventDefault();
        properties.onMove(next);
      }}
    >
      <span class="visually-hidden">
        Empty slot, {formatWeekday(properties.slot.day, "long")}{" "}
        {formatClock(properties.slot.start)}
      </span>
    </button>
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
  /** Whether an activity is placing, so a mouse over an empty slot shows the preview. */
  isPlacing: boolean;
  /** Whether Add block is open, for the empty slot it's open on. */
  isAddingBlock: boolean;
  /** Where a new block would land, while placing. */
  preview: WeekPreview | undefined;
  /**
   * An empty slot was clicked or tapped, or picked from the keyboard: placing adds a block there,
   * and otherwise Add block opens on it.
   */
  onPickSlot: (slot: Slot) => void;
  /** The mouse is over the empty slot `slot` while placing. */
  onHoverSlot: (slot: Slot) => void;
  /** The mouse left the empty slots while placing: it's over a block, a header or off the week. */
  onLeaveSlots: () => void;
}): JSX.Element {
  let scroller: HTMLElement | undefined;
  const days = () => layoutWeek(properties.plan, properties.today);
  /** Where the empty slot was last, which it keeps until a block covers it. */
  const [remembered, setRemembered] = createSignal<Slot>();
  const emptySlot = (): Slot | undefined => findEmptySlot(properties.plan, remembered());
  /** Moves the empty slot, and focus with it, to the new button drawn there. */
  const moveEmptySlotTo = (slot: Slot): void => {
    setRemembered(slot);
    focusOrWeek(scroller ?? null, EMPTY_SLOT_ID);
  };
  /**
   * Picks `slot`. While placing, the block added there covers it, so focus follows the empty slot
   * on to the next one, when it had focus. A block placed from the keyboard is animated; one
   * placed by a click isn't, since the week takes no clicks while it animates (Chromium), and
   * placing is where the next click comes right away.
   */
  const pickSlot = (slot: Slot, picker: Picker): void => {
    if (properties.planner.isOutdated()) return;
    const isFocused = document.activeElement?.id === EMPTY_SLOT_ID;
    const isPlacing = properties.isPlacing;
    setRemembered(slot);
    const place = (): void => {
      properties.onPickSlot(slot);
      if (isPlacing && isFocused) focusOrWeek(scroller ?? null, EMPTY_SLOT_ID);
    };
    if (isPlacing && picker === "keyboard") {
      animate(place);
      return;
    }
    place();
  };
  /** The preview, drawn on its day, up to midnight. */
  const drawnPreview = (): { day: DayIndex; drawn: DrawnPreview } | undefined => {
    const shown = properties.preview;
    if (shown === undefined) return undefined;
    const end = shown.start + shown.length;
    return {
      day: shown.day,
      drawn: {
        color: findColor(shown.activity.hue).key,
        start: shown.start,
        length: Math.min(shown.length, DAY - shown.start),
        time: formatClockRange(shown.start, end),
      },
    };
  };

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
        if (isOnBlock || isClickAfterDrag()) return;
        const slot = findSlot(event.currentTarget, event.clientX, event.clientY);
        selection.clear();
        // A click on an empty slot adds a block there while placing, or opens Add block on it.
        if (slot !== undefined) pickSlot(slot, "pointer");
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !properties.isPlacing) return;
        const isOnBlock =
          event.target instanceof Element && event.target.closest(".block:not(.preview)") !== null;
        const slot = isOnBlock
          ? undefined
          : findSlot(event.currentTarget, event.clientX, event.clientY);
        if (slot === undefined) {
          properties.onLeaveSlots();
          return;
        }
        properties.onHoverSlot(slot);
      }}
      onPointerLeave={() => {
        if (properties.isPlacing) properties.onLeaveSlots();
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
            {(day) => (
              <Day
                day={day()}
                planner={properties.planner}
                preview={drawnPreview()?.day === day().index ? drawnPreview()?.drawn : undefined}
              />
            )}
          </For>
        </ol>
        {/* Keyed by the slot, so each move draws a new button and is read as a new focus. */}
        <For
          each={[emptySlot()].filter((slot) => slot !== undefined)}
          keyed={(slot) => `${String(slot.day)} ${String(slot.start)}`}
        >
          {(slot) => (
            <EmptySlot
              slot={slot()}
              blocks={properties.plan.blocks}
              isAddingBlock={properties.isAddingBlock}
              isReadOnly={properties.planner.isOutdated()}
              onMove={moveEmptySlotTo}
              onPick={pickSlot}
            />
          )}
        </For>
      </div>
    </section>
  );
}
