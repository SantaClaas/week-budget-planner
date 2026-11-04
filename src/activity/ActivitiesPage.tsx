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
export function ActivitiesPage(properties: { plan: Plan; planner: Planner }): JSX.Element {
  return (
    <div class="activities-page">
      <Activities plan={properties.plan} planner={properties.planner} place="page" />
      {/* With no activities the form is already open. */}
      <Show when={properties.plan.activities.length > 0}>
        <button type="button" class="floating-action-button" onClick={edit.openNew}>
          <Icon name="add" />
          New activity
        </button>
      </Show>
    </div>
  );
}
