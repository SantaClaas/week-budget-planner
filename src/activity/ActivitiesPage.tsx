import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";
import { Activities } from "./Activities.tsx";
import * as edit from "./edit.ts";

/**
 * The Activities page: the list under its overview and, on phones, the extended "New activity"
 * button (see Layout in docs/spec/layout.md). On wide screens the rail holds that button.
 */
export function ActivitiesPage(properties: {
  plan: Plan;
  planner: Planner;
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
        place="page"
        onStartPlacing={properties.onStartPlacing}
      />
      {/* The button opens the new-activity form, so it goes while that's open, also in the empty
          state, where the form is always there. It would float over the form's pickers. */}
      <Show when={properties.plan.activities.length > 0 && edit.current()?.type !== "new"}>
        <button type="button" class="floating-action-button" onClick={edit.openNew}>
          <Icon name="add" />
          New activity
        </button>
      </Show>
    </>
  );
}
