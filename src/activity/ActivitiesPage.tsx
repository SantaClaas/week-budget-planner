import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";
import type { PlanStore } from "../storage/plan-store.ts";
import { Activities } from "./Activities.tsx";
import * as edit from "./edit.ts";

/**
 * The Activities page: the list under its overview and, on phones, the extended "New activity"
 * button (see Layout in docs/spec/layout.md). On wide screens the rail holds that button.
 */
export function ActivitiesPage(properties: {
  plan: Plan;
  planner: Planner;
  store: PlanStore;
  /** An activity started placing, which moves to the week. */
  onStartPlacing: () => void;
}): JSX.Element {
  return (
    // The list and the phone's button are the page's own parts, which <main> lays out in its
    // column, with the button pinned over the end of the list.
    <>
      <Activities
        plan={properties.plan}
        planner={properties.planner}
        store={properties.store}
        place="page"
        onStartPlacing={properties.onStartPlacing}
      />
      {/* The button goes while any activity's form is open, where it would float over the form's
          fields and pickers, and in the empty state, where the new-activity form is always there. */}
      <Show when={properties.plan.activities.length > 0 && edit.current() === undefined}>
        <button
          type="button"
          class="floating-action-button"
          aria-disabled={properties.planner.isOutdated() ? "true" : undefined}
          onClick={() => {
            if (!properties.planner.isOutdated()) edit.openNew();
          }}
        >
          <Icon name="add" />
          New activity
        </button>
      </Show>
    </>
  );
}
