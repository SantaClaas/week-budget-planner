import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { Activity } from "../plan/activity/index.ts";
import { findColor } from "../plan/activity/look.ts";
import { formatLength } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import type { Slot } from "../plan/slot.ts";
import { MAX_LENGTH, SLOT, clamp, sanitizeLength, type Length } from "../plan/time.ts";
import { describeSlot, describeStart, listChoices, type Choice } from "./index.ts";

/** The chooser's id, which its parts' ids start with. */
const ADD_BLOCK_ID = "add-block";

/** Which chooser opens: the menu beside the slot on wide screens, the bottom sheet on phones. */
export type AddBlockVariant = "menu" | "sheet";

/** What both choosers need: where the block goes, and what to do once one is chosen. */
type ChooserProperties = {
  plan: Plan;
  slot: Slot;
  /** An activity was chosen: add a block of it at the slot, `length` long. */
  onChoose: (activity: Activity, length: Length) => void;
  /** "New activity…" was chosen: open the new-activity form, then add the block. */
  onNewActivity: () => void;
  /** The chooser closed, whichever way. */
  onClose: () => void;
};

/** Takes focus to the chooser's first activity, or "New activity…" when there are none. */
function focusFirstChoice(chooser: HTMLElement | undefined): void {
  chooser?.querySelector<HTMLElement>(".choice, .new-activity")?.focus();
}

/**
 * One activity to choose: its emblem, its name and what's left of it. All placed or over budget,
 * it's dimmed but still there to choose (see Adding blocks in docs/spec/interactions.md).
 */
function ChoiceButton(properties: {
  choice: Choice;
  class: string;
  onChoose: (choice: Choice) => void;
}): JSX.Element {
  const id = (): string => `${ADD_BLOCK_ID}-${properties.choice.activity.id}`;
  return (
    <button
      type="button"
      class={`${properties.class} choice`}
      data-color={findColor(properties.choice.activity.hue).key}
      data-state={properties.choice.isWithinBudget ? undefined : "over-budget"}
      style={{ "--activity-shape": `var(--shape-${properties.choice.activity.shape})` }}
      aria-labelledby={`${id()}-name`}
      aria-describedby={`${id()}-left`}
      onClick={() => {
        properties.onChoose(properties.choice);
      }}
    >
      <span class="emblem" aria-hidden="true" />
      <span class="text">
        <span id={`${id()}-name`} class="name">
          {properties.choice.activity.name}
        </span>
        <span id={`${id()}-left`} class="body-small muted">
          {properties.choice.description}
        </span>
      </span>
    </button>
  );
}

/**
 * Add block on wide screens: a popover beside the slot, which looks like Material's menu but is a
 * list of buttons, not `role="menu"` (see Add block in docs/spec/accessibility.md). Escape or a
 * click outside closes it, and the block gets the default length.
 */
function Menu(properties: ChooserProperties): JSX.Element {
  let menu: HTMLElement | undefined;
  onSettled(() => {
    menu?.showPopover();
    focusFirstChoice(menu);
  });
  return (
    <section
      id={ADD_BLOCK_ID}
      class="menu add-block-menu"
      popover="auto"
      aria-labelledby={`${ADD_BLOCK_ID}-title`}
      ref={(created) => {
        menu = created;
      }}
      onToggle={(event) => {
        if (event.newState === "closed") properties.onClose();
      }}
    >
      <h2 id={`${ADD_BLOCK_ID}-title`} class="label-medium muted">
        Add block · {describeSlot(properties.slot)}
      </h2>
      {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops a list's semantics once the reset removes its markers (see Accessibility in docs/spec/design.md). */}
      <ul role="list">
        <For each={listChoices(properties.plan, properties.slot)}>
          {(choice) => (
            <li>
              <ChoiceButton
                choice={choice}
                class="menu-item"
                onChoose={(chosen) => {
                  menu?.hidePopover();
                  properties.onChoose(chosen.activity, chosen.length);
                }}
              />
            </li>
          )}
        </For>
      </ul>
      <hr />
      <button
        type="button"
        class="menu-item new-activity"
        onClick={() => {
          menu?.hidePopover();
          properties.onNewActivity();
        }}
      >
        <Icon name="add" />
        <span class="label-large">New activity…</span>
      </button>
    </section>
  );
}

/**
 * Add block on phones: a modal bottom sheet with a length stepper, preset to the default length of
 * the activity under focus until it's changed (see Adding blocks in docs/spec/interactions.md).
 * Escape, a tap outside or Cancel closes it.
 */
function Sheet(properties: ChooserProperties): JSX.Element {
  let sheet: HTMLDialogElement | undefined;
  const choices = (): Choice[] => listChoices(properties.plan, properties.slot);
  const [length, setLength] = createSignal<Length>(choices()[0]?.length ?? sanitizeLength(90));
  const [isLengthChanged, setIsLengthChanged] = createSignal(false);
  const step = (minutes: number): void => {
    setIsLengthChanged(true);
    setLength(sanitizeLength(clamp(length() + minutes, SLOT, MAX_LENGTH)));
  };
  /** Closes the sheet and then does what was chosen, once focus is back where it was. */
  const closeThen = (run: () => void): void => {
    sheet?.close();
    run();
  };
  onSettled(() => {
    sheet?.showModal();
    focusFirstChoice(sheet);
  });
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the backdrop tap where `closedby` is missing; Escape closes the dialog natively.
    <dialog
      id={ADD_BLOCK_ID}
      class="bottom-sheet add-block-sheet"
      closedby="any"
      aria-labelledby={`${ADD_BLOCK_ID}-title`}
      aria-describedby={`${ADD_BLOCK_ID}-start`}
      ref={(created) => {
        sheet = created;
      }}
      onClose={properties.onClose}
      onClick={(event) => {
        // Where `closedby` is missing (Safari), a tap on the backdrop reaches the dialog itself.
        if (event.target !== event.currentTarget || "closedBy" in HTMLDialogElement.prototype) {
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        const isInside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (!isInside) event.currentTarget.close();
      }}
      onFocusIn={(event) => {
        if (isLengthChanged() || !(event.target instanceof HTMLElement)) return;
        const index = Number(event.target.closest<HTMLElement>("[data-index]")?.dataset["index"]);
        const focused = choices()[index];
        if (focused !== undefined) setLength(focused.length);
      }}
    >
      <span class="drag-handle" aria-hidden="true" />
      <header>
        <h2 id={`${ADD_BLOCK_ID}-title`} class="headline-small emphasized">
          Add block
        </h2>
        <p id={`${ADD_BLOCK_ID}-start`} class="body-large muted">
          {describeStart(properties.slot)}
        </p>
      </header>
      <fieldset class="length-stepper">
        <legend class="label-large muted">Length</legend>
        <button
          type="button"
          class="icon-button"
          data-variant="tonal"
          onClick={() => {
            step(-SLOT);
          }}
        >
          <Icon name="remove" />
          <span class="visually-hidden">15 minutes shorter</span>
        </button>
        <output class="title-medium emphasized">{formatLength(length())}</output>
        <button
          type="button"
          class="icon-button"
          data-variant="tonal"
          onClick={() => {
            step(SLOT);
          }}
        >
          <Icon name="add" />
          <span class="visually-hidden">15 minutes longer</span>
        </button>
      </fieldset>
      {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops a list's semantics once the reset removes its markers (see Accessibility in docs/spec/design.md). */}
      <ul class="segmented-list" role="list">
        <For each={choices()}>
          {(choice, index) => (
            <li data-index={index()}>
              <ChoiceButton
                choice={choice}
                class="list-item"
                onChoose={(chosen) => {
                  closeThen(() => {
                    properties.onChoose(chosen.activity, length());
                  });
                }}
              />
            </li>
          )}
        </For>
      </ul>
      <footer>
        <button
          type="button"
          class="button new-activity"
          onClick={() => {
            closeThen(properties.onNewActivity);
          }}
        >
          <Icon name="add" />
          New activity…
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            sheet?.close();
          }}
        >
          Cancel
        </button>
      </footer>
    </dialog>
  );
}

/**
 * Add block: the chooser that opens on an empty slot when not placing, as a menu beside it on wide
 * screens and as a bottom sheet on phones.
 */
export function AddBlock(
  properties: ChooserProperties & { variant: AddBlockVariant },
): JSX.Element {
  return properties.variant === "menu" ? <Menu {...properties} /> : <Sheet {...properties} />;
}
