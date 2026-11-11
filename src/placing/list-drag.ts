/**
 * Dragging an activity from the list onto the week, with the week's drag controller's pieces: the
 * same threshold, the slot under the pointer, the scrolling near the week's edges and the clicks
 * ignored afterwards.
 */
import type { Activity } from "../plan/activity/index.ts";
import { fitToDayHours, pickDefaultLength } from "../plan/block/length.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex, DayMinute } from "../plan/time.ts";
import type { Planner } from "../planner/index.ts";
import * as changing from "../progress/changing.ts";
import {
  DRAG_THRESHOLD_PIXELS,
  findSlot,
  ignoreClicksAfterDrag,
  scrollNearEdge,
} from "../week/drag-controller.ts";
import * as placing from "./index.ts";

/**
 * Follows a press on an activity in the list (mouse or pen): past the threshold, a chip follows the
 * pointer, the week shows where the block would land, and a release on a day adds it there, with
 * the default length (see "Drag from the Activities list" in docs/spec/interactions.md). A press
 * that doesn't move stays a click, which starts placing.
 */
export function startListDrag(
  event: PointerEvent,
  options: {
    activity: Activity;
    plan: () => Plan;
    planner: Planner;
  },
): void {
  const { activity, planner } = options;
  const { pointerId } = event;
  const start = { x: event.clientX, y: event.clientY };
  let pointer = start;
  let isDragged = false;
  let frame = 0;
  // Everything the press changes outside itself, undone when it's released or cancelled: each step
  // runs however the release ends, even when an earlier step or the drop throws.
  const cleanup = new DisposableStack();
  // Stops every window listener of this press at once.
  const listening = cleanup.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  cleanup.defer(() => {
    cancelAnimationFrame(frame);
    delete document.documentElement.dataset["dragging"];
  });
  cleanup.defer(placing.hideChip);
  cleanup.defer(placing.hidePreview);
  cleanup.defer(changing.stop);

  /** The week's region, if this page shows it, and the slot under the pointer in it. */
  const findTarget = (): { day: DayIndex; start: DayMinute } | undefined => {
    const scroller = document.querySelector(".week-scroller");
    if (!(scroller instanceof HTMLElement)) return undefined;
    return findSlot(scroller, pointer.x, pointer.y);
  };

  const showFrame = (): void => {
    frame = 0;
    const scroller = document.querySelector(".week-scroller");
    if (scroller instanceof HTMLElement && scrollNearEdge(scroller, pointer.y)) {
      frame = requestAnimationFrame(showFrame);
    }
    const length = pickDefaultLength(activity, options.plan().blocks);
    placing.showChip({ activityId: activity.id, length, x: pointer.x, y: pointer.y });
    const slot = findTarget();
    if (slot === undefined) {
      placing.hidePreview();
      changing.stop();
      return;
    }
    // Over the week, a release would add placed time, so the activity's bar waves.
    changing.start(activity.id);
    const plan = options.plan();
    placing.showPreview({
      activityId: activity.id,
      ...slot,
      length: fitToDayHours(slot.start, length, plan),
    });
  };

  const onMove = (moved: PointerEvent): void => {
    if (moved.pointerId !== pointerId) return;
    pointer = { x: moved.clientX, y: moved.clientY };
    if (!isDragged) {
      if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < DRAG_THRESHOLD_PIXELS) return;
      isDragged = true;
      document.documentElement.dataset["dragging"] = "move";
    }
    if (frame === 0) frame = requestAnimationFrame(showFrame);
  };

  const stop = (ended: PointerEvent): void => {
    if (ended.pointerId !== pointerId) return;
    using _ending = cleanup.move();
    if (!isDragged) return;
    ignoreClicksAfterDrag();
    if (ended.type === "pointercancel") return;
    pointer = { x: ended.clientX, y: ended.clientY };
    const slot = findTarget();
    if (slot !== undefined) placing.addBlock(planner, activity, slot);
  };

  const { signal } = listening;
  window.addEventListener("pointermove", onMove, { signal });
  window.addEventListener("pointerup", stop, { signal });
  window.addEventListener("pointercancel", stop, { signal });
}
