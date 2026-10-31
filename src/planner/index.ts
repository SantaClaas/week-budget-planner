import { createSignal } from "solid-js";

import { createExampleWeek } from "../plan/example.ts";
import { randomIds } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import type { Result } from "../result.ts";
import type { Snackbar } from "../snackbar/index.ts";
import { open as openStorage } from "../storage/index.ts";
import { NewerVersionError, type PlanStore } from "../storage/plan-store.ts";
import * as saveStatus from "./save-status.ts";
import * as undo from "./undo.ts";

/**
 * The plan on screen, its undo steps, its saving and the changes other tabs save: the edge
 * between the pure plan logic and the store (see Writes and undo in docs/spec/persistence.md).
 * Every change goes through `change`, which records an undo step and saves it as one action.
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
  /** Stops following the changes other tabs save, when the app goes. */
  stop(): void;
};

/**
 * What the planner needs from the app:
 * - `showSnackbar`: shows a snackbar, such as the one offering to save a failed change again.
 * - `onNewerVersion`: what the app does once a tab on a newer version took over; the planner has
 *   already stopped every change (see "Tabs on different versions" in docs/spec/persistence.md).
 */
type Options = { showSnackbar(snackbar: Snackbar): void; onNewerVersion(): void };

/**
 * Opens the best storage and its plan, saving the example week on first run, and gives back the
 * planner for it with the store it saves to. "newer-version" when a newer version of the app saved
 * the plan, which this one can't read.
 */
export async function open(
  options: Options,
): Promise<Result<{ store: PlanStore; planner: Planner }, "newer-version">> {
  let store: PlanStore;
  let stored: Awaited<ReturnType<PlanStore["load"]>>;
  try {
    ({ store, stored } = await openAndLoad());
  } catch (error) {
    if (error instanceof NewerVersionError) return "newer-version";
    throw error;
  }
  if (stored.isStored) return { store, planner: create(store, stored.plan, options) };
  // The example week is marked as loaded at the same moment its rows are saved.
  const now = Temporal.Now.instant();
  const example = createExampleWeek(now, randomIds);
  await store.save(undefined, example, now);
  return { store, planner: create(store, example, options) };
}

async function openAndLoad() {
  const store = await openStorage();
  return { store, stored: await store.load() };
}

/** The planner for the plan `stored`, which the store already holds. */
export function create(store: PlanStore, stored: Plan, options: Options): Planner {
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
    options.showSnackbar({
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

  /**
   * Shows the plan another tab saved. The undo steps go, since applying one would write back an
   * older plan over the other tab's change.
   */
  function showSaved(changed: Plan): void {
    saved = changed;
    showChange(changed, []);
  }

  /** Stops every change, once a tab on a newer version took over the storage. */
  function stopForNewerVersion(): void {
    isStopped = true;
    setIsOutdated(true);
    options.onNewerVersion();
  }

  // Only the latest load is shown, so two quick changes in another tab can't leave the older plan
  // on screen when their loads finish out of order.
  let latestLoad = 0;
  async function showLatest(): Promise<void> {
    latestLoad += 1;
    const load = latestLoad;
    const { plan: changed } = await store.load();
    if (load === latestLoad) showSaved(changed);
  }
  const stopWatching = store.onExternalChange(() => {
    showLatest().catch((error: unknown) => {
      if (error instanceof NewerVersionError) {
        stopForNewerVersion();
        return;
      }
      // The plan on screen stays as it was; the next change in another tab tries again.
      console.error("[planner] couldn't load the plan another tab changed", error);
    });
  });

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
    stop: stopWatching,
  };
}
