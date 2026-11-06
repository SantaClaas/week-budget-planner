import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Activities } from "../activity/Activities.tsx";
import { summarize } from "../plan/budget.ts";
import { formatLength, formatLengthDatetime } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex } from "../plan/time.ts";
import type { Planner } from "../planner/index.ts";
import { Progress } from "../progress/Progress.tsx";
import { Week } from "./Week.tsx";

/** A length in a `<time>` element: "20 hr". */
function Length(properties: { minutes: number }): JSX.Element {
  return (
    <time datetime={formatLengthDatetime(properties.minutes)}>
      {formatLength(properties.minutes)}
    </time>
  );
}

/** "20 hr placed of 32 hr · 12 hr left to place", with the overall progress under it. */
function Summary(properties: { plan: Plan }): JSX.Element {
  const summary = () => summarize(properties.plan);
  return (
    <div class="summary">
      <p>
        <span class="headline-small emphasized">
          <Length minutes={summary().placed} />
        </span>{" "}
        <span class="body-large muted">
          placed of <Length minutes={summary().budget} />
        </span>{" "}
        <span class="body-large emphasized">
          ·{" "}
          <Show when={summary().leftToPlace > 0} fallback="All placed">
            <Length minutes={summary().leftToPlace} /> left to place
          </Show>
          <Show when={summary().overBudget > 0}>
            {" "}
            · <Length minutes={summary().overBudget} /> over budget
          </Show>
        </span>
      </p>
      <Progress budget={summary().budget} placed={summary().placed} />
    </div>
  );
}

/**
 * The Week page: the summary of the whole week and the week itself, with the Activities pane beside
 * them on wide screens.
 */
export function WeekPage(properties: {
  plan: Plan;
  planner: Planner;
  today: DayIndex | undefined;
}): JSX.Element {
  return (
    <div class="week-page">
      <Activities plan={properties.plan} planner={properties.planner} place="pane" />
      <Summary plan={properties.plan} />
      <Week plan={properties.plan} planner={properties.planner} today={properties.today} />
    </div>
  );
}
