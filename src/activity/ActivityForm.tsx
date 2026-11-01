import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";

import type { Mode } from "../plan/activity/index.ts";
import {
  readActivityForm,
  type ActivityFormField,
  type ActivityFormInput,
} from "../plan/activity/form.ts";
import { findColor, PALETTE, SHAPES, type Hue, type Shape } from "../plan/activity/look.ts";
import { MAX_NAME_CHARACTERS, type ActivityName } from "../plan/activity/name.ts";
import type { BudgetMinutes, DayCount } from "../plan/time.ts";

/** What the form starts with: the activity being edited, or a new one's defaults. */
export type ActivityFormValues = {
  name: string;
  /** As the hours field shows it (see `formatHours`). */
  hours: string;
  mode: Mode;
  days: string;
  hue: Hue;
  shape: Shape;
};

/** What a valid form gives back, ready to become an activity. */
export type SavedActivity = {
  name: ActivityName;
  budgetMinutes: BudgetMinutes;
  mode: Mode;
  days: DayCount;
  hue: Hue;
  shape: Shape;
};

const FIELDS: readonly ActivityFormField[] = ["name", "hours", "days"];

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
function TextField(props: {
  id: string;
  name: ActivityFormField;
  label: string;
  value: string;
  problem: string | undefined;
  isInvalid: boolean;
  inputmode?: "decimal" | "numeric";
  maxlength?: number;
  ref?: (input: HTMLInputElement) => void;
}): JSX.Element {
  return (
    <div class={["text-field", props.name]}>
      <label for={props.id}>{props.label}</label>
      <input
        id={props.id}
        name={props.name}
        required
        autocomplete="off"
        inputmode={props.inputmode}
        maxlength={props.maxlength}
        aria-invalid={props.isInvalid ? "true" : undefined}
        aria-describedby={props.isInvalid ? `${props.id}-problem` : undefined}
        ref={(input) => {
          // Set once, as a starting value: what the user types then belongs to the field.
          input.value = props.value;
          props.ref?.(input);
        }}
      />
      <Show when={props.isInvalid}>
        <p id={`${props.id}-problem`} class="supporting-text">
          {props.problem}
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
export function ActivityForm(props: {
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
  onSave(activity: SavedActivity): void;
  /** Without it, the form can't be closed, as in the empty state. */
  onCancel?: () => void;
  onDelete?: () => void;
}): JSX.Element {
  const id = createUniqueId();
  const [hue, setHue] = createSignal(props.initial.hue);
  const [shape, setShape] = createSignal(props.initial.shape);
  const [problems, setProblems] = createSignal<Partial<Record<ActivityFormField, string>>>({});
  const [invalid, setInvalid] = createSignal<ReadonlySet<ActivityFormField>>(new Set());
  let form: HTMLFormElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let isFirstInvalid = true;

  /**
   * Runs the strict parsers over every field and gives each its message, or none, as its custom
   * validity, so the browser decides what's invalid and `validationMessage` is always ours.
   */
  function validate(): void {
    if (form === undefined) return;
    const result = readActivityForm(readInput(form));
    const found = result.isOk ? {} : result.problems;
    for (const field of FIELDS) findField(form, field)?.setCustomValidity(found[field] ?? "");
    setProblems(found);
  }

  /** Marks the fields that show as invalid, so screen readers hear the error when it appears. */
  function markInvalid(): void {
    if (form === undefined) return;
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
    if (!isFirstInvalid) return;
    isFirstInvalid = false;
    if (event.target instanceof HTMLInputElement) event.target.focus();
    // The browser sends one event per invalid field, each its own task's worth of microtasks, so
    // the next submit starts over only after all of them.
    setTimeout(() => {
      isFirstInvalid = true;
      markInvalid();
    });
  };

  onSettled(() => {
    validate();
    if (props.isFocusedOnOpen) nameInput?.focus();
  });

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape in any of the form's fields cancels it, so the form listens for the key its fields pass up.
    <form
      class="activity-form"
      data-color={findColor(hue()).key}
      style={{ "--activity-shape": `var(--shape-${shape()})` }}
      aria-labelledby={`${id}-title`}
      ref={(element) => {
        form = element;
        element.addEventListener("invalid", onInvalid, true);
      }}
      onInput={() => {
        validate();
        markInvalid();
      }}
      onFocusIn={markInvalid}
      onFocusOut={markInvalid}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || props.onCancel === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        props.onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (form === undefined) return;
        const result = readActivityForm(readInput(form));
        if (!result.isOk) return;
        props.onSave({ ...result.value, hue: hue(), shape: shape() });
      }}
    >
      <div class="heading">
        <span class="swatch" />
        <Show
          when={props.level === 3}
          fallback={
            <h2 id={`${id}-title`} class="title-medium emphasized">
              {props.title}
            </h2>
          }
        >
          <h3 id={`${id}-title`} class="title-medium emphasized">
            {props.title}
          </h3>
        </Show>
        <Show when={props.placed}>
          <span class="label-medium muted">{props.placed}</span>
        </Show>
      </div>
      <div class="fields">
        <TextField
          id={`${id}-name`}
          name="name"
          label="Name"
          value={props.initial.name}
          problem={problems().name}
          isInvalid={invalid().has("name")}
          maxlength={MAX_NAME_CHARACTERS}
          ref={(input) => {
            nameInput = input;
          }}
        />
        <TextField
          id={`${id}-hours`}
          name="hours"
          label="Hours"
          value={props.initial.hours}
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
              ref={checkOnce(props.initial.mode === "week")}
            />
            per week
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="day"
              ref={checkOnce(props.initial.mode === "day")}
            />
            per day
          </label>
        </fieldset>
        <TextField
          id={`${id}-days`}
          name="days"
          label="Days"
          value={props.initial.days}
          problem={problems().days}
          isInvalid={invalid().has("days")}
          inputmode="numeric"
        />
      </div>
      <fieldset class="picker">
        <legend class="label-large muted">Color</legend>
        <For each={PALETTE}>
          {(color) => (
            <label class="picker-option" data-color={color.key}>
              <input
                type="radio"
                name="color"
                value={color.key}
                ref={checkOnce(color.hue === props.initial.hue)}
                onChange={() => {
                  setHue(color.hue);
                }}
              />
              <span class="visually-hidden">{color.name}</span>
            </label>
          )}
        </For>
      </fieldset>
      <fieldset class="picker">
        <legend class="label-large muted">Shape</legend>
        <For each={SHAPES}>
          {(option) => (
            <label class="picker-option" style={{ "--activity-shape": `var(--shape-${option})` }}>
              <input
                type="radio"
                name="shape"
                value={option}
                ref={checkOnce(option === props.initial.shape)}
                onChange={() => {
                  setShape(option);
                }}
              />
              <span class="visually-hidden">{nameShape(option)}</span>
            </label>
          )}
        </For>
      </fieldset>
      <div class="actions">
        <Show when={props.onDelete}>
          {(onDelete) => (
            <button
              type="button"
              class="button"
              data-variant="text-danger"
              onClick={() => {
                onDelete()();
              }}
            >
              Delete
            </button>
          )}
        </Show>
        <Show when={props.onCancel}>
          {(onCancel) => (
            <button
              type="button"
              class="button"
              onClick={() => {
                onCancel()();
              }}
            >
              Cancel
            </button>
          )}
        </Show>
        <button type="submit" class="button" data-variant="filled">
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}
