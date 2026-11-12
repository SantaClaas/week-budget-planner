/**
 * Reordering activities in the list (see Reorder in docs/spec/interactions.md): dragging a row by
 * its handle, and the arrow keys on the handle. It measures the list, shows each frame as the
 * planner's preview, and saves the new order once, on release. The rows that make room slide there
 * with the default spatial spring.
 */
import { flush } from "solid-js";

import { announce } from "../announcement/index.ts";
import * as list from "../plan/activity/list.ts";
import type { ActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";

/** How near the scroll area's top or bottom edge the pointer scrolls it, and by how much a frame. */
const SCROLL_EDGE_PIXELS = 32;
const SCROLL_STEP_PIXELS = 12;

/** How far each key moves an activity in the list. */
const KEY_STEPS: Partial<Record<string, -1 | 1>> = { ArrowUp: -1, ArrowDown: 1 };

/** The id of an activity's drag handle, so focus can find it again after the row moves. */
export const createHandleId = (id: ActivityId): string => `${id}-reorder`;

/** The rows of the list, in the order the page shows them. */
const listRows = (rows: HTMLElement): HTMLElement[] =>
  [...rows.children].filter(
    (row): row is HTMLElement => row instanceof HTMLElement && row.matches(".activity"),
  );

/** The middle of a row, as far down the list as its layout puts it, before any transform. */
const findMiddle = (row: HTMLElement): number => row.offsetTop + row.offsetHeight / 2;

/** The nearest ancestor that scrolls up and down, which the list scrolls in while dragging. */
function findScroller(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    const isScrolling = overflowY === "auto" || overflowY === "scroll";
    if (isScrolling && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return undefined;
}

/** Whether things may move, from the tokens' `--spatial-motion` (see Motion in docs/spec/design.md). */
const isMotionAllowed = (): boolean =>
  getComputedStyle(document.documentElement).getPropertyValue("--spatial-motion").trim() !== "0";

/**
 * Applies `update` to the page, and slides the rows it moved from where they were to where they
 * are now, with the default spatial spring. The row being dragged follows the pointer instead.
 */
function slideRows(rows: HTMLElement, update: () => void): void {
  const before = new Map(listRows(rows).map((row) => [row, row.offsetTop]));
  update();
  flush();
  if (!isMotionAllowed()) return;
  const style = getComputedStyle(document.documentElement);
  const easing = style.getPropertyValue("--spring-default-spatial").trim() || "ease-out";
  // The token is in milliseconds, as "450ms".
  const duration = Number(
    style.getPropertyValue("--spring-default-spatial-duration").trim().slice(0, -"ms".length),
  );
  for (const row of listRows(rows)) {
    const top = before.get(row);
    if (top === undefined || row.dataset["dragged"] !== undefined || top === row.offsetTop) {
      continue;
    }
    row.animate([{ translate: `0 ${String(top - row.offsetTop)}px` }, { translate: "0 0" }], {
      duration: Number.isFinite(duration) ? duration : 450,
      easing,
    });
  }
}

/** Says where the activity is now: "Gym moved to position 2 of 5". */
function announcePosition(plan: Plan, id: ActivityId): void {
  const index = plan.activities.findIndex((activity) => activity.id === id);
  const activity = plan.activities[index];
  if (activity === undefined) return;
  announce(
    `${activity.name} moved to position ${String(index + 1)} of ${String(plan.activities.length)}`,
  );
}

/**
 * Up and Down on an activity's handle move it one position (see Reorder in
 * docs/spec/interactions.md). Focus stays on its handle; at either end the key does nothing.
 */
export function moveByKey(event: KeyboardEvent, id: ActivityId, planner: Planner): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const step = KEY_STEPS[event.key];
  if (step === undefined || planner.isOutdated()) return;
  const index = planner.plan().activities.findIndex((activity) => activity.id === id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= planner.plan().activities.length) return;
  const rows = event.currentTarget instanceof Element ? event.currentTarget.closest("ul") : null;
  if (!(rows instanceof HTMLElement)) return;
  event.preventDefault();
  slideRows(rows, () => {
    planner.change((plan) => list.move(plan, id, target));
  });
  // Moving the row takes focus off its handle, so it goes back there.
  document.querySelector<HTMLElement>(`#${CSS.escape(createHandleId(id))}`)?.focus();
  announcePosition(planner.plan(), id);
}

/**
 * Follows a press on an activity's handle until it's released (see Reorder in
 * docs/spec/interactions.md): the row follows the pointer, the others make room, and the release
 * saves the new order. Escape, or a cancelled pointer, puts the row back.
 */
export function startReorder(event: PointerEvent, id: ActivityId, planner: Planner): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (planner.isOutdated() || !(event.currentTarget instanceof Element)) return;
  const row = event.currentTarget.closest(".activity");
  const rows = row?.parentElement;
  if (!(row instanceof HTMLElement) || !(rows instanceof HTMLElement)) return;
  event.preventDefault();
  const { pointerId } = event;
  const scroller = findScroller(rows);
  /** How far below the row's top the pointer took hold of it. */
  const grab = event.clientY - rows.getBoundingClientRect().top - row.offsetTop;
  const start = planner.plan().activities.findIndex((activity) => activity.id === id);
  let target = start;
  let pointerY = event.clientY;
  let frame = 0;

  // Everything the press changes outside itself, undone however it ends.
  const cleanup = new DisposableStack();
  const listening = cleanup.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  row.dataset["dragged"] = "";
  document.documentElement.dataset["dragging"] = "move";
  cleanup.defer(() => {
    cancelAnimationFrame(frame);
    delete row.dataset["dragged"];
    row.style.removeProperty("translate");
    delete document.documentElement.dataset["dragging"];
  });

  /** One position up or down when the row's middle is past its neighbour's, else where it is. */
  const findStep = (middle: number): number => {
    const shown = listRows(rows);
    const at = shown.indexOf(row);
    const above = shown[at - 1];
    const below = shown[at + 1];
    if (above !== undefined && middle < findMiddle(above)) return -1;
    return below !== undefined && middle > findMiddle(below) ? 1 : 0;
  };

  const showFrame = (): void => {
    frame = 0;
    if (scroller !== undefined) {
      const { top, bottom } = scroller.getBoundingClientRect();
      const isNearTop = pointerY < top + SCROLL_EDGE_PIXELS;
      const isNearBottom = pointerY > bottom - SCROLL_EDGE_PIXELS;
      if (isNearTop) scroller.scrollTop -= SCROLL_STEP_PIXELS;
      if (isNearBottom) scroller.scrollTop += SCROLL_STEP_PIXELS;
      // The list keeps scrolling, frame after frame, while the pointer stays at an edge.
      if (isNearTop || isNearBottom) frame = requestAnimationFrame(showFrame);
    }
    const top = pointerY - rows.getBoundingClientRect().top - grab;
    const showTarget = (): void => {
      slideRows(rows, () => {
        planner.preview((plan) => list.move(plan, id, target));
      });
    };
    // A fast drag can pass several rows in one frame, so it moves a position at a time until the
    // row is between the two neighbours its middle is between.
    for (let step = findStep(top + row.offsetHeight / 2); step !== 0;) {
      target += step;
      showTarget();
      step = findStep(top + row.offsetHeight / 2);
    }
    // Where the row is drawn, against where its place in the list puts it.
    row.style.translate = `0 ${String(top - row.offsetTop)}px`;
  };

  const onMove = (moved: PointerEvent): void => {
    if (moved.pointerId !== pointerId) return;
    pointerY = moved.clientY;
    if (frame === 0) frame = requestAnimationFrame(showFrame);
  };

  const putBack = (): void => {
    planner.endPreview();
  };

  const stop = (ended: PointerEvent): void => {
    if (ended.pointerId !== pointerId) return;
    using _ending = cleanup.move();
    if (ended.type === "pointercancel" || target === start) {
      putBack();
      return;
    }
    planner.change((plan) => list.move(plan, id, target));
    announcePosition(planner.plan(), id);
  };

  const cancelOnEscape = (key: KeyboardEvent): void => {
    if (key.key !== "Escape") return;
    key.preventDefault();
    using _ending = cleanup.move();
    putBack();
  };

  const { signal } = listening;
  window.addEventListener("pointermove", onMove, { signal });
  window.addEventListener("pointerup", stop, { signal });
  window.addEventListener("pointercancel", stop, { signal });
  window.addEventListener("keydown", cancelOnEscape, { signal });
}
