import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { splitProgress } from "../plan/budget.ts";

/**
 * Google's linear progress indicator for placed time against a budget, with the overrun in red
 * past the budget (see "Progress over budget" in docs/spec/design.md). It only draws what the text
 * beside it already says, so it's hidden from screen readers.
 */
export function Progress(props: { budget: number; placed: number }): JSX.Element {
  const split = () => splitProgress(props.budget, props.placed);
  const state = () => {
    if (split().overBudget > 0) return "over-budget";
    return split().withinBudget >= 1 ? "full" : "partial";
  };
  return (
    <div class="progress" data-state={state()} aria-hidden="true">
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
