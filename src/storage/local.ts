/* oxlint-disable require-await, typescript/require-await -- PlanStore's methods are async so that a
   throw (localStorage full or blocked, for example) arrives as a rejection, like the database's. */
import * as planFile from "../plan/file.ts";
import { randomIds } from "../plan/id.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import * as jsonFile from "./json-file.ts";
import { NewerVersionError, type PlanStore } from "./plan-store.ts";

export const PLAN_KEY = "week-budget-planner.plan";

const NEWER_VERSION_MESSAGE =
  "Your plan was saved by a newer version of Week Budget Planner. Reload to update the app.";

/** The stored plan, or a throw when a newer version of the app wrote it. */
function readStored(text: string): Plan {
  const plan = planFile.parse(text, randomIds);
  if (plan === "newer-version") throw new NewerVersionError(NEWER_VERSION_MESSAGE);
  return plan;
}

/**
 * Throws when another tab running a newer version of the app has written the plan since, so this
 * one doesn't write over what it can't read.
 */
function refuseNewerStored(storage: Storage): void {
  const text = storage.getItem(PLAN_KEY);
  if (text !== null && planFile.isWrittenByNewerVersion(text)) {
    throw new NewerVersionError(NEWER_VERSION_MESSAGE);
  }
}

/**
 * The limited level: the plan as JSON in localStorage (the stored format of
 * examples/example-week.json). Other tabs pick up changes through the `storage` event; the last
 * write wins.
 */
export function create(
  storage: Storage,
  events: Pick<Window, "addEventListener" | "removeEventListener">,
): PlanStore {
  let current: Plan | undefined;
  return {
    level: "limited",
    async load() {
      const text = storage.getItem(PLAN_KEY);
      current = text === null ? undefined : readStored(text);
      return { plan: current ?? createEmptyPlan(), isStored: text !== null };
    },
    async save(_before, after) {
      refuseNewerStored(storage);
      storage.setItem(PLAN_KEY, planFile.serialize(after));
      current = after;
    },
    async exportFile() {
      const text = storage.getItem(PLAN_KEY);
      const plan = text === null ? (current ?? createEmptyPlan()) : readStored(text);
      return jsonFile.create(plan, Temporal.Now.plainDateISO());
    },
    async importFile(file) {
      const plan = await jsonFile.read(file);
      refuseNewerStored(storage);
      storage.setItem(PLAN_KEY, planFile.serialize(plan));
      current = plan;
    },
    async wipe() {
      storage.removeItem(PLAN_KEY);
      current = undefined;
    },
    onExternalChange(callback) {
      const listener = (event: StorageEvent): void => {
        if (event.key === null || event.key === PLAN_KEY) callback();
      };
      events.addEventListener("storage", listener);
      return () => {
        events.removeEventListener("storage", listener);
      };
    },
  };
}

/** Writes and removes a key, which throws when the storage is full or blocked. */
function writeProbe(storage: Storage): void {
  const probe = `${PLAN_KEY}.probe`;
  storage.setItem(probe, "1");
  storage.removeItem(probe);
}

/** Whether localStorage can actually be written (it can be missing, or throw, when blocked). */
export function findWritableStorage(): Storage | undefined {
  let storage: Storage;
  try {
    storage = globalThis.localStorage;
  } catch {
    return undefined;
  }
  try {
    writeProbe(storage);
  } catch {
    return undefined;
  }
  return storage;
}
