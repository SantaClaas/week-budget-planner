import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, onSettled, Show } from "solid-js";

import { splitProgress } from "../plan/budget.ts";
import {
  AMPLITUDE,
  changeAmplitude,
  drawWave,
  FLAT,
  isFlat,
  readAmplitude,
  readPhase,
  type AmplitudeChange,
} from "./wave.ts";

/** Whether this browser can draw the wave: without `clip-path: shape()`, the bar stays flat. */
const isWaveSupported = (): boolean =>
  CSS.supports("clip-path", "shape(from 0 0, line to 1px 1px, close)");

/** Whether things may move, from the tokens' `--spatial-motion` (see Motion in docs/spec/design.md). */
const isMotionAllowed = (): boolean =>
  getComputedStyle(document.documentElement).getPropertyValue("--spatial-motion").trim() !== "0";

/** One rem in CSS pixels, to turn what's measured into the wave's rem. A computed font size is
 * always in pixels, as "16px". */
const measureRem = (): number =>
  Number(getComputedStyle(document.documentElement).fontSize.slice(0, -"px".length));

/**
 * Draws the wave on the bar's parts for `now`: each part's width and its offset from the bar's
 * start are measured each frame, since the bar follows the drag.
 */
function drawFrame(bar: HTMLElement, amplitude: number, now: number): void {
  const rem = measureRem();
  const start = bar.getBoundingClientRect();
  const isRightToLeft = getComputedStyle(bar).direction === "rtl";
  for (const part of bar.querySelectorAll<HTMLElement>(".indicator, .over-budget")) {
    const box = part.getBoundingClientRect();
    part.style.clipPath = drawWave({
      width: box.width / rem,
      offset: (isRightToLeft ? start.right - box.right : box.left - start.left) / rem,
      amplitude: amplitude * AMPLITUDE,
      phase: readPhase(now),
      isRightToLeft,
    });
  }
}

/** Takes the wave off the bar's parts, back to the flat bar's own look. */
function flatten(bar: HTMLElement): void {
  delete bar.dataset["wavy"];
  for (const part of bar.querySelectorAll<HTMLElement>(".indicator, .over-budget")) {
    part.style.removeProperty("clip-path");
  }
}

/**
 * Google's linear progress indicator for placed time against a budget, with the overrun in red
 * past the budget (see "Progress over budget" in docs/spec/design.md). While `isWavy`, it turns
 * into Google's wavy indicator: the wave grows, travels one wavelength a second, and flattens
 * again once `isWavy` is off (see "Wavy progress while resizing"). It only draws what the text
 * beside it already says, so it's hidden from screen readers.
 */
export function Progress(properties: {
  budget: number;
  placed: number;
  isWavy?: boolean;
}): JSX.Element {
  // Worked out once per change of the budget or what's placed, however often it's read below.
  const split = createMemo(() => splitProgress(properties.budget, properties.placed));
  // Two comparisons on the memo's numbers, too little to be worth a memo of its own.
  const state = () => {
    const { withinBudget, overBudget } = split();
    if (overBudget > 0) return "over-budget";
    return withinBudget >= 1 ? "full" : "partial";
  };

  let bar: HTMLElement | undefined;
  let amplitude: AmplitudeChange = FLAT;
  let frame = 0;
  /** Draws a frame and asks for the next, until the wave is flat and stays flat. */
  const animate = (): void => {
    frame = 0;
    if (bar === undefined) return;
    const now = performance.now();
    if (isFlat(amplitude, now)) {
      flatten(bar);
      return;
    }
    bar.dataset["wavy"] = "";
    drawFrame(bar, readAmplitude(amplitude, now), now);
    frame = requestAnimationFrame(animate);
  };
  createEffect(
    () => properties.isWavy === true,
    (isWavy) => {
      // With reduced motion, or without shape(), only the width changes.
      if (isWavy && (!isWaveSupported() || !isMotionAllowed())) return;
      const now = performance.now();
      // A bar that's flat and stays flat has nothing to draw, as on the first run.
      if (!isWavy && isFlat(amplitude, now)) return;
      amplitude = changeAmplitude(amplitude, isWavy ? 1 : 0, now);
      if (frame === 0) frame = requestAnimationFrame(animate);
    },
  );
  onSettled(() => () => {
    cancelAnimationFrame(frame);
  });

  return (
    <div
      class="progress"
      data-state={state()}
      aria-hidden="true"
      ref={(element) => {
        bar = element;
      }}
    >
      <span
        class="indicator"
        style={
          state() === "partial"
            ? { width: `${(split().withinBudget * 100).toString()}%` }
            : { flex: split().withinBudget.toString() }
        }
      />
      <Show when={state() === "over-budget"}>
        <span class="over-budget" style={{ flex: split().overBudget.toString() }} />
      </Show>
      <span class="track" />
    </div>
  );
}
