import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, flush, For, Show } from "solid-js";

import { announce } from "../announcement/index.ts";
import { Icon } from "../icons/Icon.tsx";
import { formatHours } from "../plan/activity/form.ts";
import { formatCount } from "../plan/format.ts";
import * as list from "../plan/activity/list.ts";
import { findColor, pickDefaultLook } from "../plan/activity/look.ts";
import { createExampleWeek, keepExampleWeek, startEmpty } from "../plan/example.ts";
import { randomIds, type ActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";
import { Progress } from "../progress/Progress.tsx";
import * as snackbar from "../snackbar/index.ts";
import * as placing from "../placing/index.ts";
import { startListDrag } from "../placing/list-drag.ts";
import { isClickAfterDrag } from "../week/drag-controller.ts";
import { ActivityForm } from "./ActivityForm.tsx";
import * as edit from "./edit.ts";
import { describeOverview, listRows, type ActivityRow } from "./row.ts";

/** Where the list is: the pane beside the week, or the Activities page. */
type Place = "pane" | "page";

/** Takes focus to the element the selector finds, once the page shows it. */
function focus(selector: string): void {
  flush();
  const element = document.querySelector(selector);
  if (element instanceof HTMLElement) element.focus();
}

/** The id of an activity's Edit button, so focus can go back to it when its form closes. */
const createEditButtonId = (id: ActivityId): string => `edit-${id}`;

/** Takes focus to the Edit button of the activity `id`. */
function focusEditButton(id: ActivityId): void {
  focus(`#${CSS.escape(createEditButtonId(id))}`);
}

/** The id of an activity's form, which its Edit button controls while it's open. */
const createFormId = (id: ActivityId): string => `edit-form-${id}`;

/** "Deleted Gym and its 3 blocks.", or "Deleted Gym." when it had none. */
function describeRemoval(name: string, removedBlocks: number): string {
  if (removedBlocks === 0) return `Deleted ${name}.`;
  return `Deleted ${name} and its ${formatCount(removedBlocks, { one: "block", other: "blocks" })}.`;
}

/** The pane's heading, which names it and takes focus once the example-week note goes. */
const ACTIVITIES_TITLE_ID = "activities-title";

/** Takes focus to the list's heading: the pane's "Activities", or else the page's own heading. */
function focusHeading(): void {
  flush();
  const heading =
    document.querySelector(`#${ACTIVITIES_TITLE_ID}`) ?? document.querySelector("main h1");
  if (heading instanceof HTMLElement) heading.focus();
}

/** The example-week note's "Keep these", which takes focus once the example week is loaded. */
const KEEP_EXAMPLE_WEEK_ID = "keep-example-week";

/** Shows a snackbar whose Undo goes back one step, as the Undo button does. */
function showWithUndo(planner: Planner, message: string): void {
  snackbar.show({
    message,
    action: {
      label: "Undo",
      run: () => {
        planner.undo();
      },
    },
  });
}

/**
 * The note on the example week, while it's there: keep it, or start with an empty week (see
 * Layout in docs/spec/layout.md). Its text describes both buttons, so their context is read when
 * they get focus.
 */
function ExampleWeekCard(properties: { planner: Planner }): JSX.Element {
  return (
    <section class="example-week-card">
      <Icon name="auto_awesome" />
      <p class="body-medium" id="example-week-note">
        <strong>This is an example week.</strong> Change it, or start with an empty one.
      </p>
      <footer>
        <button
          type="button"
          class="button"
          id={KEEP_EXAMPLE_WEEK_ID}
          data-size="extra-small"
          aria-describedby="example-week-note"
          onClick={() => {
            properties.planner.change(keepExampleWeek);
            // The note goes with the button, so focus moves to the list's heading: the pane's, or
            // on the Activities page the page's own.
            focusHeading();
          }}
        >
          Keep these
        </button>
        <button
          type="button"
          class="button"
          data-size="extra-small"
          data-variant="filled"
          aria-describedby="example-week-note"
          onClick={() => {
            // The form for a new activity takes focus, as the next thing to do.
            edit.openNew();
            properties.planner.change(startEmpty);
            showWithUndo(properties.planner, "Example week removed.");
          }}
        >
          Start empty
        </button>
      </footer>
    </section>
  );
}

/**
 * The form of the activity in `row`, below its row: Save, Cancel and Delete. Each moves focus on
 * before the form goes, so the focused control is never removed from under a screen reader.
 */
function EditForm(properties: {
  row: ActivityRow;
  plan: Plan;
  planner: Planner;
  level: 2 | 3;
}): JSX.Element {
  const id = (): ActivityId => properties.row.activity.id;
  const close = (): void => {
    focusEditButton(id());
    edit.close();
  };
  return (
    <ActivityForm
      id={createFormId(id())}
      title={`Edit ${properties.row.activity.name}`}
      level={properties.level}
      initial={{
        name: properties.row.activity.name,
        hours: formatHours(properties.row.activity.budgetMinutes),
        mode: properties.row.activity.mode,
        days: String(properties.row.activity.days),
        hue: properties.row.activity.hue,
        shape: properties.row.activity.shape,
      }}
      placed={properties.row.placed}
      submitLabel="Save"
      isFocusedOnOpen
      onSave={(saved) => {
        properties.planner.change((plan) => list.update(plan, id(), saved));
        close();
      }}
      onCancel={close}
      onDelete={() => {
        const { name } = properties.row.activity;
        const index = properties.plan.activities.findIndex((activity) => activity.id === id());
        const neighbor =
          properties.plan.activities[index + 1] ?? properties.plan.activities[index - 1];
        // Focus goes to the next activity before this one goes, or with none left, to the form
        // for a new one.
        if (neighbor !== undefined) focusEditButton(neighbor.id);
        // Counted on the plan the change applies to, so the snackbar says what was removed.
        let removedBlocks = 0;
        properties.planner.change((plan) => {
          const removal = list.remove(plan, id());
          removedBlocks = removal.removedBlocks;
          return removal.plan;
        });
        showWithUndo(properties.planner, describeRemoval(name, removedBlocks));
        if (neighbor === undefined) {
          edit.openNew();
          return;
        }
        edit.close();
      }}
    />
  );
}

/**
 * One activity in the list: its emblem, name, budget, what's left to place, and Edit. Edit opens
 * the activity's form below the row, in the same list item, and closes it again.
 */
function Row(properties: {
  row: ActivityRow;
  plan: Plan;
  planner: Planner;
  level: 2 | 3;
  isEditing: boolean;
  /** What else starting to place does where the list is: on its own page, it moves to the week. */
  onStartPlacing: () => void;
}): JSX.Element {
  const id = (): ActivityId => properties.row.activity.id;
  return (
    <li
      class="activity"
      data-color={findColor(properties.row.activity.hue).key}
      style={{ "--activity-shape": `var(--shape-${properties.row.activity.shape})` }}
    >
      <button
        type="button"
        class="activity-button"
        aria-pressed={placing.current() === id() ? "true" : "false"}
        aria-labelledby={`${id()}-name`}
        aria-describedby={`${id()}-budget ${id()}-left`}
        onPointerDown={(event) => {
          // A pointer drags the activity onto the week; touch taps it to start placing instead.
          if (event.pointerType === "touch" || event.button !== 0) return;
          startListDrag(event, {
            activity: properties.row.activity,
            plan: () => properties.plan,
            planner: properties.planner,
          });
        }}
        onClick={() => {
          if (isClickAfterDrag()) return;
          if (placing.current() === id()) {
            placing.stop();
            return;
          }
          placing.start(id());
          properties.onStartPlacing();
        }}
      >
        <span class="emblem" aria-hidden="true" />
        <span class="name">
          <span class="title-medium" id={`${id()}-name`}>
            {properties.row.activity.name}
          </span>
          <span class="body-small muted" id={`${id()}-budget`}>
            {properties.row.budget}
          </span>
        </span>
        <span class="left-to-place" id={`${id()}-left`} data-state={properties.row.state}>
          <span class="title-small">{properties.row.figure}</span>
          <span class="label-small muted">{properties.row.caption}</span>
        </span>
      </button>
      <button
        type="button"
        class="icon-button"
        id={createEditButtonId(id())}
        aria-expanded={properties.isEditing ? "true" : "false"}
        aria-controls={properties.isEditing ? createFormId(id()) : undefined}
        onClick={() => {
          if (properties.isEditing) {
            edit.close();
            return;
          }
          edit.open(id());
        }}
      >
        <Icon name="edit" size={20} />
        <span class="visually-hidden">Edit {properties.row.activity.name}</span>
      </button>
      <Progress budget={properties.row.weeklyBudget} placed={properties.row.placedMinutes} />
      <Show when={properties.isEditing}>
        <EditForm
          row={properties.row}
          plan={properties.plan}
          planner={properties.planner}
          level={properties.level}
        />
      </Show>
    </li>
  );
}

/**
 * The new-activity form. After adding, it opens again empty, with the next defaults, for the next
 * activity, as in the prototype.
 */
function NewActivity(properties: {
  plan: Plan;
  planner: Planner;
  level: 2 | 3;
  /** In the empty state the form is always there, and can't be closed. */
  isClosable: boolean;
  /** Takes focus to the name when it opens, unless it's there from the start. */
  isFocusedOnOpen: boolean;
}): JSX.Element {
  // The new activity's id is made when the form opens, so its default look is known before it's
  // saved, and stays the same while the form is open.
  const [id, setId] = createSignal(randomIds.createActivityId());
  const [isAfterSave, setIsAfterSave] = createSignal(false);
  return (
    <Show when={id()} keyed>
      {(newId) => {
        const look = pickDefaultLook(newId, properties.plan.activities);
        return (
          <ActivityForm
            title="New activity"
            level={properties.level}
            initial={{ name: "", hours: "", mode: "week", days: "5", ...look }}
            submitLabel="Add activity"
            isFocusedOnOpen={properties.isFocusedOnOpen || isAfterSave()}
            onSave={(saved) => {
              properties.planner.change((plan) => list.add(plan, { ...saved, id: newId }));
              announce(`Added ${saved.name}.`);
              // The form stays open for the next activity, also after the first one in the empty
              // state, where the list then takes the empty state's place.
              edit.openNew();
              setIsAfterSave(true);
              setId(randomIds.createActivityId());
            }}
            {...(properties.isClosable ? { onCancel: edit.close } : {})}
          />
        );
      }}
    </Show>
  );
}

/** With no activities: what to do first, the form, and the example week to try instead. */
function EmptyState(properties: { plan: Plan; planner: Planner; level: 2 | 3 }): JSX.Element {
  return (
    <>
      <p class="body-medium muted intro">
        Add what fills your week, like a class, your job or the gym, and how many hours each one
        needs.
      </p>
      <NewActivity
        plan={properties.plan}
        planner={properties.planner}
        level={properties.level}
        isClosable={false}
        isFocusedOnOpen={edit.current()?.type === "new"}
      />
      <p class="divider body-small muted">or</p>
      <button
        type="button"
        class="button load-example"
        data-variant="outlined"
        onClick={() => {
          edit.close();
          properties.planner.change((_, now) => createExampleWeek(now, randomIds));
          // The button goes with the empty state, so focus moves to the note that replaces it.
          focus(`#${KEEP_EXAMPLE_WEEK_ID}`);
        }}
      >
        <Icon name="auto_awesome" />
        Load an example week
      </button>
    </>
  );
}

/** The activity whose form is open in its row, if any. */
function findEditedId(): ActivityId | undefined {
  const open = edit.current();
  return open?.type === "edit" ? open.id : undefined;
}

/**
 * The Activities list with everything around it: the example-week note, the overview, the forms
 * and the empty state. The same list is the pane beside the week on wide screens and the
 * Activities page (see Layout in docs/spec/layout.md).
 */
export function Activities(properties: {
  plan: Plan;
  planner: Planner;
  place: Place;
  /**
   * An activity started placing. The Activities page moves to the week, where the slots are; the
   * pane needs nothing, since the week is beside it.
   */
  onStartPlacing?: () => void;
}): JSX.Element {
  const rows = createMemo(() => listRows(properties.plan));
  const startPlacing = (): void => {
    properties.onStartPlacing?.();
  };
  const overview = () => describeOverview(properties.plan);
  const level = (): 2 | 3 => (properties.place === "pane" ? 3 : 2);
  return (
    <section
      class="activities"
      data-place={properties.place}
      aria-labelledby={properties.place === "pane" ? ACTIVITIES_TITLE_ID : undefined}
    >
      <Show when={properties.plan.exampleLoadedAt !== null}>
        <ExampleWeekCard planner={properties.planner} />
      </Show>
      {/* The pane's heading is there with or without activities, so the forms' headings below
          it never skip a level, and it names the pane. */}
      <Show when={properties.place === "pane"}>
        <header>
          <h2 id={ACTIVITIES_TITLE_ID} class="title-medium emphasized" tabindex="-1">
            Activities
          </h2>
          <Show when={properties.plan.activities.length > 0}>
            <p class="label-medium muted">{overview().leftToPlace}</p>
          </Show>
        </header>
      </Show>
      <Show
        when={properties.plan.activities.length > 0}
        fallback={
          <EmptyState plan={properties.plan} planner={properties.planner} level={level()} />
        }
      >
        <Show when={properties.place === "page"}>
          <p class="body-large muted overview">
            <strong>{overview().leftToPlace}</strong> {overview().detail}
          </p>
        </Show>
        <Show when={edit.current()?.type === "new"}>
          <NewActivity
            plan={properties.plan}
            planner={properties.planner}
            level={level()}
            isClosable
            isFocusedOnOpen
          />
        </Show>
        {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops a list's semantics once the reset removes its markers (see Accessibility in docs/spec/design.md). */}
        <ul class="segmented-list activity-list" role="list">
          <For each={rows()} keyed={(row) => row.activity.id}>
            {(row) => (
              <Row
                row={row()}
                plan={properties.plan}
                planner={properties.planner}
                level={level()}
                isEditing={row().activity.id === findEditedId()}
                onStartPlacing={startPlacing}
              />
            )}
          </For>
        </ul>
        <Show when={properties.place === "page"}>
          <p class="body-small muted hint">
            <span class="for-fine-pointer">
              Click an activity to place it, then click a slot on the week.
            </span>
            <span class="for-coarse-pointer">
              Tap an activity to place it, then tap a slot on the week.
            </span>
          </p>
        </Show>
      </Show>
    </section>
  );
}
