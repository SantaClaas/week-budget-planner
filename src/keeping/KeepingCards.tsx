import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { Plan } from "../plan/index.ts";
import * as persistence from "../storage/persistence.ts";
import type { PlanStore } from "../storage/plan-store.ts";
import { ask, exportPlan, isAnswered, isAskDue, markAnswered } from "./index.ts";

/**
 * The card that asks before the browser does (see Keeping the data in docs/spec/persistence.md),
 * at the top of the Activities list, where the example-week card was: "Not now" puts it away for
 * good, and only "Keep it" asks the browser. `onAnswered` moves focus on before the card goes, so
 * the focused button isn't removed from under a screen reader.
 */
export function KeepPlanCard(properties: {
  plan: Plan;
  store: PlanStore;
  onAnswered: () => void;
}): JSX.Element {
  const [state, setState] = createSignal<persistence.KeepingState>();
  const [isAnsweredNow, setIsAnsweredNow] = createSignal(isAnswered());
  onSettled(() => {
    // findState() never rejects: each browser call in it falls back on failure.
    void persistence.findState().then(setState);
  });
  const answer = (): void => {
    markAnswered(Temporal.Now.instant());
    properties.onAnswered();
    setIsAnsweredNow(true);
  };
  const keep = async (): Promise<void> => {
    answer();
    setState(await ask(properties.store));
  };
  return (
    <Show
      when={isAskDue({
        plan: properties.plan,
        level: properties.store.level,
        state: state(),
        isAnswered: isAnsweredNow(),
      })}
    >
      <section class="keep-plan-card" aria-labelledby="keep-plan-title">
        <Icon name="gpp_maybe" />
        <p class="body-medium" id="keep-plan-note">
          <strong id="keep-plan-title">Your browser may delete your plan</strong> if it runs low on
          space. Ask it to keep your plan?
        </p>
        <footer>
          <button
            type="button"
            class="button"
            data-size="extra-small"
            aria-describedby="keep-plan-note"
            onClick={answer}
          >
            Not now
          </button>
          <button
            type="button"
            class="button"
            data-size="extra-small"
            data-variant="filled"
            aria-describedby="keep-plan-note"
            onClick={() => {
              void keep();
            }}
          >
            Keep it
          </button>
        </footer>
      </section>
    </Show>
  );
}

// Once put away, the card stays away in this tab, also when the page changes. There's no storage
// to remember it across tabs: that's what the card is about.
const [isNoStorageDismissed, setIsNoStorageDismissed] = createSignal(false);

/**
 * The card that says nothing is saved, without storage (see Progressive enhancement in
 * docs/spec/persistence.md), at the top of the Activities list, until it's put away in this tab.
 * Export downloads the plan as a `.json` file, the one way to keep it here.
 */
export function NoStorageCard(properties: {
  store: PlanStore;
  onDismissed: () => void;
}): JSX.Element {
  return (
    <Show when={properties.store.level === "none" && !isNoStorageDismissed()}>
      <section class="no-storage-card" aria-labelledby="no-storage-title">
        <Icon name="cloud_off" />
        <p class="body-medium" id="no-storage-note">
          <strong id="no-storage-title">This browser doesn't allow saving here.</strong> Your
          changes are lost when you close this tab. Export to keep them.
        </p>
        <footer>
          <button
            type="button"
            class="button"
            data-size="extra-small"
            aria-describedby="no-storage-note"
            onClick={() => {
              properties.onDismissed();
              setIsNoStorageDismissed(true);
            }}
          >
            Dismiss
          </button>
          <button
            type="button"
            class="button"
            data-size="extra-small"
            data-variant="filled"
            aria-describedby="no-storage-note"
            onClick={() => {
              // exportPlan() reports its own failure.
              void exportPlan(properties.store);
            }}
          >
            Export
          </button>
        </footer>
      </section>
    </Show>
  );
}
