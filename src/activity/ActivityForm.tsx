import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";

import type { Activity, Mode } from "../plan/activity/index.ts";
import {
  readActivityForm,
  type ActivityFormField,
  type ActivityFormInput,
} from "../plan/activity/form.ts";
import { findColor, PALETTE, SHAPES, type Hue, type Shape } from "../plan/activity/look.ts";
import { MAX_NAME_CHARACTERS } from "../plan/activity/name.ts";

/** What the form starts with: the activity being edited, or a new one's defaults. */
type ActivityFormValues = {
  name: string;
  /** As the hours field shows it (see `formatHours`). */
  hours: string;
  mode: Mode;
  days: string;
  hue: Hue;
  shape: Shape;
};

const FIELDS: readonly ActivityFormField[] = ["name", "hours", "days"];

/** The value of the radio input a picker's change came from. */
const readPicked = (event: Event): string | undefined =>
  event.target instanceof HTMLInputElement ? event.target.value : undefined;

/** A shape's name as a person reads it: "clover 8", "puffy diamond". */
const nameShape = (shape: Shape): string => shape.replaceAll("-", " ");

/** The form's values as typed, read from the form itself, which holds them. */
function readInput(form: HTMLFormElement): ActivityFormInput {
  const data = new FormData(form);
  const read = (name: string): string => {
    const value = data.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    name: read("name"),
    hours: read("hours"),
    mode: read("mode") === "day" ? "day" : "week",
    days: read("days"),
  };
}

/**
 * The color and shape the pickers hold. Undefined only if a picker has none checked, which the
 * form never allows, since each starts with one.
 */
function readLook(form: HTMLFormElement): Pick<Activity, "hue" | "shape"> | undefined {
  const data = new FormData(form);
  const color = PALETTE.find((option) => option.key === data.get("color"));
  const shape = SHAPES.find((option) => option === data.get("shape"));
  if (color === undefined || shape === undefined) return undefined;
  return { hue: color.hue, shape };
}

/**
 * Checks a radio input once, when it's made. Solid sets `value` and `checked` again whenever
 * another attribute of the same input changes, which would undo what the user chose, so the form's
 * starting values are set once and the form holds them from then on.
 */
const checkOnce =
  (isChecked: boolean) =>
  (input: HTMLInputElement): void => {
    input.checked = isChecked;
  };

/** The form's text field for `field`, if it's there. */
function findField(form: HTMLFormElement, field: ActivityFormField): HTMLInputElement | undefined {
  const element = form.elements.namedItem(field);
  return element instanceof HTMLInputElement ? element : undefined;
}

/**
 * An outlined text field: its label, the input, and under it the error message once the field
 * shows as invalid, which also describes it (see Activities in docs/spec/interactions.md).
 */
function TextField(properties: {
  id: string;
  name: ActivityFormField;
  label: string;
  value: string;
  problem: string | undefined;
  isInvalid: boolean;
  inputmode?: "decimal" | "numeric";
  maxlength?: number;
}): JSX.Element {
  return (
    <div class={["text-field", properties.name]}>
      <label for={properties.id}>{properties.label}</label>
      <input
        id={properties.id}
        name={properties.name}
        required
        autocomplete="off"
        inputmode={properties.inputmode}
        maxlength={properties.maxlength}
        aria-invalid={properties.isInvalid ? "true" : undefined}
        aria-describedby={properties.isInvalid ? `${properties.id}-problem` : undefined}
        ref={(input) => {
          // Set once, as a starting value: what the user types then belongs to the field.
          input.value = properties.value;
        }}
      />
      <Show when={properties.isInvalid}>
        <p id={`${properties.id}-problem`} class="supporting-text">
          {properties.problem}
        </p>
      </Show>
    </div>
  );
}

/**
 * The activity form, for a new activity and for editing one: name, hours, counted per week or per
 * day, days (per day only), color and shape. It validates with the platform's constraint
 * validation and the strict parsers' messages: a field shows its error once the user is done with
 * it (`:user-invalid`), and the error clears as soon as the value is fixed. Escape cancels.
 */
export function ActivityForm(properties: {
  /** The form's id, for an Edit button that controls it. */
  id?: string;
  /** "New activity" or "Edit Gym". */
  title: string;
  /** The heading level of the title: 3 under the pane's "Activities", 2 on the Activities page. */
  level: 2 | 3;
  initial: ActivityFormValues;
  /** "4 hr, 30 min placed", for an activity being edited. */
  placed?: string;
  submitLabel: string;
  /** Takes focus to the name when the form opens, for a form the user opened. */
  isFocusedOnOpen: boolean;
  onSave(activity: Omit<Activity, "id">): void;
  /** Without it, the form can't be closed, as in the empty state. */
  onCancel?: () => void;
  onDelete?: () => void;
  /**
   * A tab on a newer version took over, so saving and deleting would change a plan that can't be
   * saved: they're disabled, and only Cancel works.
   */
  isReadOnly?: boolean;
}): JSX.Element {
  const id = createUniqueId();
  const readOnlyState = (): "true" | undefined =>
    properties.isReadOnly === true ? "true" : undefined;
  const [hue, setHue] = createSignal(properties.initial.hue);
  const [shape, setShape] = createSignal(properties.initial.shape);
  const [problems, setProblems] = createSignal<Partial<Record<ActivityFormField, string>>>({});
  const [invalid, setInvalid] = createSignal<ReadonlySet<ActivityFormField>>(new Set());
  // Only for the first check and the focus on open, once the form is in the page: its fields aren't
  // inside it yet when the ref runs. The handlers get the form from their events.
  let created: HTMLFormElement | undefined;
  let isFirstInvalid = true;

  /**
   * Runs the strict parsers over every field and gives each its message, or none, as its custom
   * validity, so the browser decides what's invalid and `validationMessage` is always ours.
   */
  function validate(form: HTMLFormElement): void {
    // Days count only per day. Per week the field is hidden, and disabled too, which keeps it out
    // of the browser's validation: an empty, hidden field would otherwise block the submit
    // without a word.
    const days = findField(form, "days");
    if (days !== undefined) days.disabled = readInput(form).mode === "week";
    const result = readActivityForm(readInput(form));
    const found = result.isOk ? {} : result.problems;
    for (const field of FIELDS) findField(form, field)?.setCustomValidity(found[field] ?? "");
    setProblems(found);
  }

  /** Marks the fields that show as invalid, so screen readers hear the error when it appears. */
  function markInvalid(form: HTMLFormElement): void {
    const shown = new Set<ActivityFormField>();
    for (const field of FIELDS) {
      if (findField(form, field)?.matches(":user-invalid") === true) shown.add(field);
    }
    setInvalid(shown);
  }

  /**
   * The browser found an invalid field on submit: its message already shows under the field, so
   * the browser's bubble is hidden, and focus moves to the first invalid field.
   */
  const onInvalid = (event: Event): void => {
    event.preventDefault();
    if (!isFirstInvalid || !(event.target instanceof HTMLInputElement)) return;
    const { form } = event.target;
    if (form === null) return;
    isFirstInvalid = false;
    event.target.focus();
    // The browser sends one event per invalid field, each its own task's worth of microtasks, so
    // the next submit starts over only after all of them.
    setTimeout(() => {
      isFirstInvalid = true;
      markInvalid(form);
    });
  };

  onSettled(() => {
    if (created === undefined) return;
    validate(created);
    if (properties.isFocusedOnOpen) findField(created, "name")?.focus();
  });

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape in any of the form's fields cancels it, so the form listens for the key its fields pass up.
    <form
      id={properties.id}
      class="activity-form"
      data-color={findColor(hue()).key}
      style={{ "--activity-shape": `var(--shape-${shape()})` }}
      aria-labelledby={`${id}-title`}
      ref={(element) => {
        created = element;
        element.addEventListener("invalid", onInvalid, true);
      }}
      onInput={(event) => {
        validate(event.currentTarget);
        markInvalid(event.currentTarget);
      }}
      onFocusIn={(event) => {
        markInvalid(event.currentTarget);
      }}
      onFocusOut={(event) => {
        markInvalid(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || properties.onCancel === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        properties.onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const result = readActivityForm(readInput(event.currentTarget));
        // What's saved is what the inputs hold; the hue and shape signals only draw the choice.
        const look = readLook(event.currentTarget);
        if (!result.isOk || look === undefined || properties.isReadOnly === true) return;
        properties.onSave({ ...result.value, ...look });
      }}
    >
      {/* The title and what's placed, read as one heading with its subtitle. */}
      <hgroup>
        <Show
          when={properties.level === 3}
          fallback={
            <h2 id={`${id}-title`} class="title-medium emphasized">
              <span class="emblem" aria-hidden="true" />
              {properties.title}
            </h2>
          }
        >
          <h3 id={`${id}-title`} class="title-medium emphasized">
            <span class="emblem" aria-hidden="true" />
            {properties.title}
          </h3>
        </Show>
        <Show when={properties.placed}>
          <p class="label-medium muted">{properties.placed}</p>
        </Show>
      </hgroup>
      <TextField
        id={`${id}-name`}
        name="name"
        label="Name"
        value={properties.initial.name}
        problem={problems().name}
        isInvalid={invalid().has("name")}
        maxlength={MAX_NAME_CHARACTERS}
      />
      {/* The budget: how many hours, counted per week or per day on a number of days (see the
          glossary in docs/spec/glossary.md). */}
      <fieldset class="budget">
        <legend class="visually-hidden">Budget</legend>
        <TextField
          id={`${id}-hours`}
          name="hours"
          label="Hours"
          value={properties.initial.hours}
          problem={problems().hours}
          isInvalid={invalid().has("hours")}
          inputmode="decimal"
        />
        <fieldset class="connected-button-group mode">
          <legend class="visually-hidden">Counted</legend>
          <label>
            <input
              type="radio"
              name="mode"
              value="week"
              ref={checkOnce(properties.initial.mode === "week")}
            />
            per week
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="day"
              ref={checkOnce(properties.initial.mode === "day")}
            />
            per day
          </label>
        </fieldset>
        <TextField
          id={`${id}-days`}
          name="days"
          label="Days"
          value={properties.initial.days}
          problem={problems().days}
          isInvalid={invalid().has("days")}
          inputmode="numeric"
        />
      </fieldset>
      {/* The radio input that changes passes its change up, so the group listens once. */}
      <fieldset
        class="picker"
        onChange={(event) => {
          const picked = PALETTE.find((color) => color.key === readPicked(event));
          if (picked !== undefined) setHue(picked.hue);
        }}
      >
        <legend class="label-large muted">Color</legend>
        <For each={PALETTE}>
          {(color) => (
            <label class="picker-option" data-color={color.key}>
              <span class="emblem" aria-hidden="true" />
              <input
                type="radio"
                name="color"
                value={color.key}
                ref={checkOnce(color.hue === properties.initial.hue)}
              />
              <span class="visually-hidden">{color.name}</span>
            </label>
          )}
        </For>
      </fieldset>
      <fieldset
        class="picker"
        onChange={(event) => {
          const picked = SHAPES.find((option) => option === readPicked(event));
          if (picked !== undefined) setShape(picked);
        }}
      >
        <legend class="label-large muted">Shape</legend>
        <For each={SHAPES}>
          {(option) => (
            <label class="picker-option" style={{ "--activity-shape": `var(--shape-${option})` }}>
              <span class="emblem" aria-hidden="true" />
              <input
                type="radio"
                name="shape"
                value={option}
                ref={checkOnce(option === properties.initial.shape)}
              />
              <span class="visually-hidden">{nameShape(option)}</span>
            </label>
          )}
        </For>
      </fieldset>
      <Show when={properties.onDelete}>
        {(onDelete) => (
          <button
            type="button"
            class="button delete"
            data-variant="text-danger"
            aria-disabled={readOnlyState()}
            onClick={() => {
              if (properties.isReadOnly !== true) onDelete()();
            }}
          >
            Delete
          </button>
        )}
      </Show>
      <Show when={properties.onCancel}>
        {(onCancel) => (
          <button type="button" class="button cancel" onClick={onCancel()}>
            Cancel
          </button>
        )}
      </Show>
      <button type="submit" class="button" data-variant="filled" aria-disabled={readOnlyState()}>
        {properties.submitLabel}
      </button>
    </form>
  );
}
