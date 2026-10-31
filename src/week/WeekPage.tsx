import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { summarize } from "../plan/budget.ts";
import { formatLength, formatLengthDatetime } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex } from "../plan/time.ts";
import { Progress } from "../progress/Progress.tsx";
import { Week } from "./Week.tsx";

/** A length in a `<time>` element: "20 hr". */
function Length(props: { minutes: number }): JSX.Element {
  return <time datetime={formatLengthDatetime(props.minutes)}>{formatLength(props.minutes)}</time>;
}

/** "20 hr placed of 32 hr · 12 hr left to place", with the overall progress under it. */
function Summary(props: { plan: Plan }): JSX.Element {
  const summary = () => summarize(props.plan);
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

/** The Week page: the summary of the whole week, and the week itself. */
export function WeekPage(props: { plan: Plan; today: DayIndex | undefined }): JSX.Element {
  return (
    <div class="week-page">
      <Summary plan={props.plan} />
      <Week plan={props.plan} today={props.today} />
    </div>
  );
}
