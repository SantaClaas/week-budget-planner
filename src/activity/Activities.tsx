import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, flush, For, Show } from "solid-js";

import { announce } from "../announcement/index.ts";
import { Icon } from "../icons/Icon.tsx";
import { formatHours } from "../plan/activity/form.ts";
import * as list from "../plan/activity/list.ts";
import { findColor, pickDefaultLook } from "../plan/activity/look.ts";
import { createExampleWeek, keepExampleWeek, startEmpty } from "../plan/example.ts";
import { randomIds, type ActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";
import { Progress } from "../progress/Progress.tsx";
import * as snackbar from "../snackbar/index.ts";
import { ActivityForm, type SavedActivity } from "./ActivityForm.tsx";
import * as editing from "./editing.ts";
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

/** Takes focus to the Edit button of the activity `id`, once the list shows it again. */
function focusEditButton(id: ActivityId): void {
  focus(`#${CSS.escape(createEditButtonId(id))}`);
}

/** "Deleted Gym and its 3 blocks.", or "Deleted Gym." when it had none. */
function describeRemoval(name: string, removedBlocks: number): string {
  if (removedBlocks === 0) return `Deleted ${name}.`;
  return `Deleted ${name} and its ${String(removedBlocks)} ${removedBlocks === 1 ? "block" : "blocks"}.`;
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
function ExampleWeekCard(props: { planner: Planner }): JSX.Element {
  return (
    <section class="example-week-card">
      <Icon name="auto_awesome" />
      <p class="body-medium" id="example-week-note">
        <strong>This is an example week.</strong> Change it, or start with an empty one.
      </p>
      <div class="actions">
        <button
          type="button"
          class="button"
          id={KEEP_EXAMPLE_WEEK_ID}
          data-size="extra-small"
          aria-describedby="example-week-note"
          onClick={() => {
            props.planner.change(keepExampleWeek);
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
            editing.openNew();
            props.planner.change(startEmpty);
            showWithUndo(props.planner, "Example week removed.");
          }}
        >
          Start empty
        </button>
      </div>
    </section>
  );
}

/** One activity in the list: its shape, name, budget, what's left to place, and Edit. */
function Row(props: { row: ActivityRow }): JSX.Element {
  return (
    <li
      class="activity"
      data-color={findColor(props.row.activity.hue).key}
      style={{ "--activity-shape": `var(--shape-${props.row.activity.shape})` }}
    >
      <span class="swatch" />
      <span class="name">
        <span class="title-medium">{props.row.activity.name}</span>
        <span class="body-small muted">{props.row.budget}</span>
      </span>
      <span class="left-to-place" data-state={props.row.state}>
        <span class="title-small">{props.row.figure}</span>
        <span class="label-small muted">{props.row.caption}</span>
      </span>
      <button
        type="button"
        class="icon-button"
        id={createEditButtonId(props.row.activity.id)}
        onClick={() => {
          editing.openEdit(props.row.activity.id);
        }}
      >
        <Icon name="edit" size={20} />
        <span class="visually-hidden">Edit {props.row.activity.name}</span>
      </button>
      <Progress budget={props.row.weeklyBudget} placed={props.row.placedMinutes} />
    </li>
  );
}

/** The form of the activity in `row`, in its place in the list: Save, Cancel and Delete. */
function EditRow(props: { row: ActivityRow; plan: Plan; planner: Planner; level: 2 | 3 }) {
  const id = (): ActivityId => props.row.activity.id;
  const close = (): void => {
    editing.close();
    focusEditButton(id());
  };
  return (
    <li class="editing">
      <ActivityForm
        title={`Edit ${props.row.activity.name}`}
        level={props.level}
        initial={{
          name: props.row.activity.name,
          hours: formatHours(props.row.activity.budgetMinutes),
          mode: props.row.activity.mode,
          days: String(props.row.activity.days),
          hue: props.row.activity.hue,
          shape: props.row.activity.shape,
        }}
        placed={props.row.placed}
        submitLabel="Save"
        isFocusedOnOpen
        onSave={(saved: SavedActivity) => {
          props.planner.change((plan) => list.update(plan, id(), saved));
          close();
        }}
        onCancel={close}
        onDelete={() => {
          const { name } = props.row.activity;
          const index = props.plan.activities.findIndex((activity) => activity.id === id());
          const neighbour = props.plan.activities[index + 1] ?? props.plan.activities[index - 1];
          const { removedBlocks } = list.remove(props.plan, id());
          props.planner.change((plan) => list.remove(plan, id()).plan);
          showWithUndo(props.planner, describeRemoval(name, removedBlocks));
          // Focus goes to the next activity, or with none left, to the form for a new one.
          if (neighbour === undefined) {
            editing.openNew();
            return;
          }
          editing.close();
          focusEditButton(neighbour.id);
        }}
      />
    </li>
  );
}

/**
 * The new-activity form. After adding, it opens again empty, with the next defaults, for the next
 * activity, as in the prototype.
 */
function NewActivity(props: {
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
        const look = pickDefaultLook(newId, props.plan.activities);
        return (
          <ActivityForm
            title="New activity"
            level={props.level}
            initial={{ name: "", hours: "", mode: "week", days: "5", ...look }}
            submitLabel="Add activity"
            isFocusedOnOpen={props.isFocusedOnOpen || isAfterSave()}
            onSave={(saved) => {
              props.planner.change((plan) => list.add(plan, { ...saved, id: newId }));
              announce(`Added ${saved.name}.`);
              // The form stays open for the next activity, also after the first one in the empty
              // state, where the list then takes the empty state's place.
              editing.openNew();
              setIsAfterSave(true);
              setId(randomIds.createActivityId());
            }}
            {...(props.isClosable ? { onCancel: editing.close } : {})}
          />
        );
      }}
    </Show>
  );
}

/** With no activities: what to do first, the form, and the example week to try instead. */
function EmptyState(props: { plan: Plan; planner: Planner; level: 2 | 3 }): JSX.Element {
  return (
    <>
      <p class="body-medium muted intro">
        Add what fills your week, like a class, your job or the gym, and how many hours each one
        needs.
      </p>
      <NewActivity
        plan={props.plan}
        planner={props.planner}
        level={props.level}
        isClosable={false}
        isFocusedOnOpen={editing.editing()?.type === "new"}
      />
      <p class="divider body-small muted">or</p>
      <button
        type="button"
        class="button load-example"
        data-variant="outlined"
        onClick={() => {
          editing.close();
          props.planner.change((_, now) => createExampleWeek(now, randomIds));
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
  const open = editing.editing();
  return open?.type === "edit" ? open.id : undefined;
}

/**
 * The Activities list with everything around it: the example-week note, the overview, the forms
 * and the empty state. The same list is the pane beside the week on wide screens and the
 * Activities page (see Layout in docs/spec/layout.md).
 */
export function Activities(props: { plan: Plan; planner: Planner; place: Place }): JSX.Element {
  const rows = createMemo(() => listRows(props.plan));
  const overview = () => describeOverview(props.plan);
  const level = (): 2 | 3 => (props.place === "pane" ? 3 : 2);
  return (
    <section
      class="activities"
      data-place={props.place}
      aria-labelledby={props.place === "pane" ? "activities-title" : undefined}
    >
      <Show when={props.plan.exampleLoadedAt !== null}>
        <ExampleWeekCard planner={props.planner} />
      </Show>
      <Show
        when={props.plan.activities.length > 0}
        fallback={<EmptyState plan={props.plan} planner={props.planner} level={level()} />}
      >
        <Show
          when={props.place === "pane"}
          fallback={
            <p class="body-large muted overview">
              <strong>{overview().leftToPlace}</strong> {overview().detail}
            </p>
          }
        >
          <div class="heading">
            <h2 id="activities-title" class="title-medium emphasized">
              Activities
            </h2>
            <span class="label-medium muted">{overview().leftToPlace}</span>
          </div>
        </Show>
        <Show when={editing.editing()?.type === "new"}>
          <NewActivity
            plan={props.plan}
            planner={props.planner}
            level={level()}
            isClosable
            isFocusedOnOpen
          />
        </Show>
        {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops a list's semantics once the reset removes its markers (see Accessibility in docs/spec/design.md). */}
        <ul class="segmented-list activity-list" role="list">
          <For each={rows()} keyed={(row) => row.activity.id}>
            {(row) => (
              <Show when={row().activity.id === findEditedId()} fallback={<Row row={row()} />}>
                <EditRow row={row()} plan={props.plan} planner={props.planner} level={level()} />
              </Show>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
