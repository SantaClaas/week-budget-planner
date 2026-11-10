import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Activities } from "../activity/Activities.tsx";
import * as placing from "../placing/index.ts";
import type { Activity } from "../plan/activity/index.ts";
import { fitToDayHours, pickDefaultLength } from "../plan/block/length.ts";
import { summarize } from "../plan/budget.ts";
import { formatLength, formatLengthDatetime } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex } from "../plan/time.ts";
import type { Planner } from "../planner/index.ts";
import { Progress } from "../progress/Progress.tsx";
import type { Slot } from "../week/drag-controller.ts";
import { Week, type WeekPreview } from "../week/Week.tsx";

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
  /** The activity that's placing, while it's still in the plan. */
  const findPlacingActivity = (): Activity | undefined =>
    properties.plan.activities.find((activity) => activity.id === placing.current());
  /** The preview with its activity, while that activity is still in the plan. */
  const findPreview = (): WeekPreview | undefined => {
    const shown = placing.preview();
    const activity = properties.plan.activities.find((each) => each.id === shown?.activityId);
    if (shown === undefined || activity === undefined) return undefined;
    return { activity, day: shown.day, start: shown.start, length: shown.length };
  };
  const addBlock = (slot: Slot): void => {
    const activity = findPlacingActivity();
    if (activity === undefined) return;
    placing.addBlock(properties.planner, activity, slot);
  };
  /** Shows where a block of the placing activity would land, with its default length. */
  const showPreview = (slot: Slot): void => {
    const activity = findPlacingActivity();
    if (activity === undefined) return;
    const length = pickDefaultLength(activity, properties.plan.blocks);
    placing.showPreview({
      activityId: activity.id,
      ...slot,
      length: fitToDayHours(slot.start, length, properties.plan),
    });
  };

  return (
    <div class="week-page">
      <Activities plan={properties.plan} planner={properties.planner} place="pane" />
      <Summary plan={properties.plan} />
      <Week
        plan={properties.plan}
        planner={properties.planner}
        today={properties.today}
        isPlacing={findPlacingActivity() !== undefined}
        preview={findPreview()}
        onPickSlot={addBlock}
        onHoverSlot={showPreview}
        onLeaveSlots={placing.hidePreview}
      />
    </div>
  );
}
