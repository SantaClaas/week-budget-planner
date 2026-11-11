/**
 * The one drag controller of the week: it follows a pointer from the press on a block to its
 * release, with listeners on the window, so the drag goes on when the pointer leaves the block or
 * the block is drawn again in another day (see Editing blocks in docs/spec/interactions.md). It
 * measures the page, hands the pure arithmetic in ./drag.ts the pointer's place, and shows each
 * frame as the planner's preview. Only the release saves, and only when something changed.
 */
import * as list from "../plan/block/list.ts";
import type { Plan } from "../plan/index.ts";
import type { Slot } from "../plan/slot.ts";
import { sanitizeDayIndex, sanitizeDayMinute, snapDown } from "../plan/time.ts";
import type { BlockPart } from "../plan/week.ts";
import type { Planner } from "../planner/index.ts";
import { drag, measureGrab, readMinute, type Grip, type PointerPlace } from "./drag.ts";

/** How far the pointer moves before a press becomes a drag, so a click stays a click. */
export const DRAG_THRESHOLD_PIXELS = 4;
/** How long clicks are ignored after a drag, so the click that ends it does nothing else. */
const CLICK_PAUSE_MILLISECONDS = 350;
/** How near the week's top or bottom edge the pointer scrolls it, and by how much per frame. */
const SCROLL_EDGE_PIXELS = 32;
const SCROLL_STEP_PIXELS = 14;

let clicksIgnoredUntil = 0;

/** Whether a click comes right after a drag, and so belongs to it. */
export const isClickAfterDrag = (): boolean => performance.now() < clicksIgnoredUntil;

/** Ignores clicks for a moment, after a drag ended, so the click that ends it does nothing else. */
export function ignoreClicksAfterDrag(): void {
  clicksIgnoredUntil = performance.now() + CLICK_PAUSE_MILLISECONDS;
}

/** The day column under the pointer, or the nearest one across, and the minute at its height. */
function readPlace(scroller: HTMLElement, x: number, y: number): PointerPlace | undefined {
  const columns = [...scroller.querySelectorAll(".day-column")];
  let nearest: { index: number; distance: number; rectangle: DOMRect } | undefined;
  for (const [index, column] of columns.entries()) {
    const rectangle = column.getBoundingClientRect();
    const distance = x < rectangle.left ? rectangle.left - x : Math.max(0, x - rectangle.right);
    if (nearest === undefined || distance < nearest.distance) {
      nearest = { index, distance, rectangle };
    }
  }
  if (nearest === undefined) return undefined;
  return {
    day: sanitizeDayIndex(nearest.index),
    minute: readMinute(y - nearest.rectangle.top, nearest.rectangle.height),
  };
}

/**
 * The empty slot under a point in the week, as a day and the slot's start: only inside a day
 * column, below the sticky day headers. Undefined anywhere else.
 */
export function findSlot(scroller: HTMLElement, x: number, y: number): Slot | undefined {
  const headers = scroller.querySelector(".day-header")?.getBoundingClientRect().bottom ?? 0;
  if (y < headers) return undefined;
  for (const [index, column] of [...scroller.querySelectorAll(".day-column")].entries()) {
    const rectangle = column.getBoundingClientRect();
    const isInside = x >= rectangle.left && x < rectangle.right;
    if (isInside && y >= rectangle.top && y < rectangle.bottom) {
      const minute = readMinute(y - rectangle.top, rectangle.height);
      return { day: sanitizeDayIndex(index), start: sanitizeDayMinute(snapDown(minute)) };
    }
  }
  return undefined;
}

/**
 * Scrolls the week a step when the pointer is near its top or bottom edge. The top edge is where
 * the hours start, under the sticky day headers.
 */
export function scrollNearEdge(scroller: HTMLElement, y: number): boolean {
  const { bottom } = scroller.getBoundingClientRect();
  const top =
    scroller.querySelector(".day-header")?.getBoundingClientRect().bottom ??
    scroller.getBoundingClientRect().top;
  if (y > bottom - SCROLL_EDGE_PIXELS) {
    scroller.scrollTop += SCROLL_STEP_PIXELS;
    return true;
  }
  if (y < top + SCROLL_EDGE_PIXELS) {
    scroller.scrollTop -= SCROLL_STEP_PIXELS;
    return true;
  }
  return false;
}

/**
 * Follows the press `event` on `part` until it's released. `onDone` hears whether the press
 * became a drag, after the change is saved.
 */
export function startDrag(
  event: PointerEvent,
  options: {
    part: Pick<BlockPart, "block" | "kind">;
    grip: Grip;
    planner: Planner;
    scroller: HTMLElement;
    onDone: (isDragged: boolean) => void;
  },
): void {
  const { part, grip, planner, scroller } = options;
  const { pointerId } = event;
  const start = { x: event.clientX, y: event.clientY };
  const first = readPlace(scroller, start.x, start.y);
  if (first === undefined) return;
  const grab = measureGrab(part, first.minute);
  let pointer = start;
  let isDragged = false;
  let frame = 0;
  // Stops every window listener of this press at once, when it's released or cancelled.
  const listening = new AbortController();

  /** The change to the plan with the pointer where it is now. */
  const update = (): ((plan: Plan) => Plan) => {
    const place = readPlace(scroller, pointer.x, pointer.y);
    return (plan) =>
      place === undefined ? plan : list.update(plan, drag(part, grip, grab, place));
  };

  const showFrame = (): void => {
    frame = 0;
    // Near an edge the week keeps scrolling, frame after frame, while the pointer stays there.
    if (scrollNearEdge(scroller, pointer.y)) frame = requestAnimationFrame(showFrame);
    planner.preview(update());
  };

  const onMove = (moved: PointerEvent): void => {
    if (moved.pointerId !== pointerId) return;
    pointer = { x: moved.clientX, y: moved.clientY };
    if (!isDragged) {
      if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < DRAG_THRESHOLD_PIXELS) return;
      isDragged = true;
      document.documentElement.dataset["dragging"] = grip === "body" ? "move" : "resize";
    }
    if (frame === 0) frame = requestAnimationFrame(showFrame);
  };

  const stop = (ended: PointerEvent): void => {
    if (ended.pointerId !== pointerId) return;
    listening.abort();
    cancelAnimationFrame(frame);
    delete document.documentElement.dataset["dragging"];
    if (!isDragged) {
      options.onDone(false);
      return;
    }
    ignoreClicksAfterDrag();
    // A cancelled drag (the browser took the pointer, say for a scroll) puts the block back.
    if (ended.type === "pointercancel") {
      planner.endPreview();
      options.onDone(true);
      return;
    }
    pointer = { x: ended.clientX, y: ended.clientY };
    planner.change(update());
    options.onDone(true);
  };

  const { signal } = listening;
  window.addEventListener("pointermove", onMove, { signal });
  window.addEventListener("pointerup", stop, { signal });
  window.addEventListener("pointercancel", stop, { signal });
}
