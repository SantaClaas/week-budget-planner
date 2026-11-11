import type { JSX } from "@solidjs/web";
import { createSignal, flush, Show } from "solid-js";

import { Activities } from "../activity/Activities.tsx";
import { AddBlock, type AddBlockVariant } from "../add-block/AddBlock.tsx";
import { describeAdded } from "../add-block/index.ts";
import * as placing from "../placing/index.ts";
import type { Activity } from "../plan/activity/index.ts";
import { fitToDayHours, pickDefaultLength } from "../plan/block/length.ts";
import * as list from "../plan/block/list.ts";
import { randomIds } from "../plan/id.ts";
import { summarize } from "../plan/budget.ts";
import { formatLength, formatLengthDatetime } from "../plan/format.ts";
import type { Block } from "../plan/block/index.ts";
import type { Plan } from "../plan/index.ts";
import type { DayIndex, Length as BlockLength } from "../plan/time.ts";
import type { Planner } from "../planner/index.ts";
import { Progress } from "../progress/Progress.tsx";
import * as snackbar from "../snackbar/index.ts";
import type { Slot } from "../plan/slot.ts";
import * as selection from "../week/selection.ts";
import { Week, type WeekPreview } from "../week/Week.tsx";
import { ClearWeek, DayHours } from "../week/WeekTools.tsx";

/** A length in a `<time>` element: "20 hr". */
function Length(properties: { minutes: number }): JSX.Element {
  return (
    <time datetime={formatLengthDatetime(properties.minutes)}>
      {formatLength(properties.minutes)}
    </time>
  );
}

/**
 * "20 hr placed of 32 hr · 12 hr left to place", with the overall progress under it, and Day hours
 * and Clear week beside it on wide screens (on phones they're in Settings › Week).
 */
function Summary(properties: { plan: Plan; planner: Planner }): JSX.Element {
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
      <DayHours plan={properties.plan} planner={properties.planner} variant="button" />
      <ClearWeek plan={properties.plan} planner={properties.planner} variant="button" />
    </div>
  );
}

/** Phones get the bottom sheet, wide screens the menu, as the layout switches (52.5em). */
const PHONE_QUERY = "(width < 52.5em)";

/**
 * Adds a block of `activity` at the slot, `length` long or else with its default length, selects it and takes focus to it, and
 * says so in a snackbar with Undo (see Adding blocks in docs/spec/interactions.md).
 */
function addChosenBlock(
  planner: Planner,
  activity: Activity,
  slot: Slot,
  length?: BlockLength,
): void {
  const id = randomIds.createBlockId();
  let added: Block | undefined;
  planner.change((plan) => {
    const created = list.create(plan, activity, slot, id);
    added = { ...created, length: length ?? created.length };
    return list.add(plan, added);
  });
  if (added === undefined) return;
  selection.select(id);
  snackbar.show({
    message: describeAdded(activity, added),
    action: {
      label: "Undo",
      run: () => {
        planner.undo();
      },
    },
  });
  flush();
  document.querySelector<HTMLElement>(`[data-block="${CSS.escape(id)}"] .block-button`)?.focus();
}

/**
 * The Week page: the summary of the whole week and the week itself, with the Activities pane beside
 * them on wide screens.
 */
export function WeekPage(properties: {
  plan: Plan;
  planner: Planner;
  today: DayIndex | undefined;
  /**
   * Add block's "New activity…": opens the new-activity form, wherever it is on this screen, and
   * calls `onCreated` with the activity once it's added.
   */
  onNewActivity: (onCreated: (activity: Activity) => void) => void;
}): JSX.Element {
  /** The slot Add block is open on, and which chooser it is. */
  const [adding, setAdding] = createSignal<{ slot: Slot; variant: AddBlockVariant }>();
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
  /** Placing adds a block at the slot picked; otherwise Add block opens on it. */
  const pickSlot = (slot: Slot): void => {
    const activity = findPlacingActivity();
    if (activity !== undefined) {
      placing.addBlock(properties.planner, activity, slot);
      return;
    }
    setAdding({ slot, variant: matchMedia(PHONE_QUERY).matches ? "sheet" : "menu" });
  };
  /** "New activity…": the form opens, and its activity gets the block, with its default length. */
  const addWithNewActivity = (slot: Slot): void => {
    // The page may be gone by then, on a phone, where the form is on the Activities page.
    const { planner } = properties;
    properties.onNewActivity((activity) => {
      addChosenBlock(planner, activity, slot);
    });
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
      <Summary plan={properties.plan} planner={properties.planner} />
      <Week
        plan={properties.plan}
        planner={properties.planner}
        today={properties.today}
        isPlacing={findPlacingActivity() !== undefined}
        preview={findPreview()}
        isAddingBlock={adding() !== undefined}
        onPickSlot={pickSlot}
        onHoverSlot={showPreview}
        onLeaveSlots={placing.hidePreview}
      />
      <Show when={adding()} keyed>
        {(open) => (
          <AddBlock
            plan={properties.plan}
            slot={open.slot}
            variant={open.variant}
            onChoose={(activity, length) => {
              addChosenBlock(properties.planner, activity, open.slot, length);
            }}
            onNewActivity={() => {
              addWithNewActivity(open.slot);
            }}
            onClose={() => {
              setAdding(undefined);
            }}
          />
        )}
      </Show>
    </div>
  );
}
