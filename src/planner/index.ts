import { createSignal } from "solid-js";

import type { Plan } from "../plan/index.ts";
import * as snackbar from "../snackbar/index.ts";
import type { PlanStore } from "../storage/plan-store.ts";
import * as saveStatus from "./save-status.ts";
import * as undo from "./undo.ts";

/**
 * The plan on screen, its undo steps and its saving: the edge between the pure plan logic and
 * the store (see Writes and undo in docs/spec/persistence.md). Every change goes through
 * `change`, which records an undo step and saves it as one action.
 */
export type Planner = {
  plan(): Plan;
  /** Whether a tab on a newer version took over, so this one can't change or save anything. */
  isOutdated(): boolean;
  canUndo(): boolean;
  saveStatus(): ReturnType<typeof saveStatus.describe>;
  /**
   * Applies one user action: `update` gets the plan and the action's `now`, and gives back the
   * changed plan, or the same one when nothing changed. Does nothing in an outdated tab.
   */
  change(update: (before: Plan, now: Temporal.Instant) => Plan): void;
  /** Goes back one step and saves that, as its own action. */
  undo(): void;
  /**
   * Shows the plan another tab saved. The undo steps go, since applying one would write back an
   * older plan over the other tab's change.
   */
  showSaved(changed: Plan): void;
  /** Stops every change, once a tab on a newer version took over the storage. */
  stopForNewerVersion(): void;
};

/** The planner for the plan `stored`, which the store already holds. */
export function create(store: PlanStore, stored: Plan): Planner {
  // Solid shows a write only after it flushes, so two changes in one event would read the same
  // plan from the signals. The plan and the steps live here, and the signals follow them.
  let current = stored;
  let steps: readonly Plan[] = [];
  const [plan, setPlan] = createSignal(current);
  const [stepCount, setStepCount] = createSignal(0);
  const [saveState, setSaveState] = createSignal<saveStatus.SaveState>("saved");
  const [isOutdated, setIsOutdated] = createSignal(false);

  // The plan as the store holds it, which every save starts from. Saves run one after the other,
  // so each one's `before` is what the previous one left (see Plan store in src/storage/).
  let saved = stored;
  let saving: Promise<void> = Promise.resolve();
  let openSaves = 0;
  let isFailing = false;
  let isStopped = false;

  function showChange(next: Plan, nextSteps: readonly Plan[]): void {
    current = next;
    steps = nextSteps;
    setPlan(next);
    setStepCount(nextSteps.length);
  }

  /** Saves `after` once the saves before it are done, and says how it went. */
  function save(after: Plan, now: Temporal.Instant): void {
    openSaves += 1;
    setSaveState("saving");
    saving = saving.then(() => saveNow(after, now));
  }

  async function saveNow(after: Plan, now: Temporal.Instant): Promise<void> {
    try {
      await store.save(saved, after, now);
    } catch (error) {
      openSaves -= 1;
      failSave(error);
      return;
    }
    saved = after;
    openSaves -= 1;
    isFailing = false;
    if (openSaves === 0) setSaveState("saved");
  }

  /** Keeps the change on screen and offers to save it again (see Writes and undo). */
  function failSave(error: unknown): void {
    console.error("[planner] couldn't save the change", error);
    setSaveState("failed");
    if (isFailing) return;
    isFailing = true;
    snackbar.show({
      message: "Couldn't save your last change. It's still on screen.",
      urgency: "assertive",
      isLasting: true,
      action: {
        label: "Retry",
        run: () => {
          isFailing = false;
          save(current, Temporal.Now.instant());
        },
      },
    });
  }

  return {
    plan,
    isOutdated,
    canUndo: () => stepCount() > 0 && !isOutdated(),
    saveStatus: () => saveStatus.describe(store.level, saveState(), isOutdated()),
    change(update: (before: Plan, now: Temporal.Instant) => Plan): void {
      if (isStopped) return;
      const now = Temporal.Now.instant();
      const before = current;
      const after = update(before, now);
      if (after === before) return;
      showChange(after, undo.push(steps, before));
      save(after, now);
    },
    undo(): void {
      const previous = steps.at(-1);
      if (previous === undefined || isStopped) return;
      showChange(previous, steps.slice(0, -1));
      save(previous, Temporal.Now.instant());
    },
    showSaved(changed: Plan): void {
      saved = changed;
      showChange(changed, []);
    },
    stopForNewerVersion(): void {
      isStopped = true;
      setIsOutdated(true);
    },
  };
}
