import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, Show } from "solid-js";

import { splitProgress } from "../plan/budget.ts";
import type { Placed, WeeklyBudget } from "../plan/time.ts";

/** Whether this browser can draw the wave: without `clip-path: shape()`, the bar stays flat. */
const isWaveSupported = (): boolean =>
  CSS.supports("clip-path", "shape(from 0 0, curve by 1px 0px with 1px 1px, close)");

/** Whether things may move, from the tokens' `--spatial-motion` (see Motion in docs/spec/design.md). */
const isMotionAllowed = (): boolean =>
  getComputedStyle(document.documentElement).getPropertyValue("--spatial-motion").trim() !== "0";

/** The transition of the wave's amplitude on `bar`, while it runs. */
const findAmplitudeTransition = (bar: HTMLElement): CSSTransition | undefined =>
  bar
    .getAnimations()
    .find(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === "--wave-amplitude",
    );

/** Takes the wave off once it's flat, unless it came back on meanwhile. */
async function takeOffWhenFlat(bar: HTMLElement, flattening: CSSTransition): Promise<void> {
  try {
    await flattening.finished;
  } catch {
    // Cancelled: the wave is back on, and the next settle takes it off.
    return;
  }
  if (bar.dataset["wave"] === "settling") delete bar.dataset["wave"];
}

/**
 * Lets the wave flatten, then takes it off, so the bar stops travelling once it's flat. A wave
 * that never grew has nothing to flatten and comes off at once.
 */
function settle(bar: HTMLElement): void {
  bar.dataset["wave"] = "settling";
  const flattening = findAmplitudeTransition(bar);
  if (flattening === undefined) {
    delete bar.dataset["wave"];
    return;
  }
  // takeOffWhenFlat() handles its own failure: a cancelled transition.
  void takeOffWhenFlat(bar, flattening);
}

/**
 * Google's linear progress indicator for placed time against a budget, with the overrun in red
 * past the budget (see "Progress over budget" in docs/spec/design.md). While `isWavy`, it turns
 * into Google's wavy indicator, which the stylesheet draws from `data-wave` (see "Wavy progress
 * while resizing"): the wave grows, travels, and flattens again once `isWavy` is off. It only
 * draws what the text beside it already says, so it's hidden from screen readers.
 */
export function Progress(properties: {
  budget: WeeklyBudget;
  placed: Placed;
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
  createEffect(
    () => properties.isWavy === true,
    (isWavy) => {
      if (bar === undefined) return;
      if (!isWavy) {
        if (bar.dataset["wave"] === "on") settle(bar);
        return;
      }
      // With reduced motion, or without shape(), only the width changes.
      if (isWaveSupported() && isMotionAllowed()) bar.dataset["wave"] = "on";
    },
  );

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
