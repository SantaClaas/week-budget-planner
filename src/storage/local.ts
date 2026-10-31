/* oxlint-disable require-await, typescript/require-await -- PlanStore's methods are async so that a
   throw (localStorage full or blocked, for example) arrives as a rejection, like the database's. */
import * as planFile from "../plan/file.ts";
import { randomIds } from "../plan/id.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import * as jsonFile from "./json-file.ts";
import type { Result } from "../result.ts";
import type { PlanStore } from "./plan-store.ts";

export const PLAN_KEY = "week-budget-planner.plan";

/**
 * Whether another tab running a newer version of the app has written the plan since, so this one
 * mustn't write over what it can't read.
 */
function isNewerStored(storage: Storage): boolean {
  const text = storage.getItem(PLAN_KEY);
  return text !== null && planFile.isWrittenByNewerVersion(text);
}

/** The stored plan, or the plan this tab holds when nothing is stored. */
function readStored(storage: Storage, current?: Plan): Result<Plan, "newer-version"> {
  const text = storage.getItem(PLAN_KEY);
  if (text === null) return current ?? createEmptyPlan();
  return planFile.parse(text, randomIds);
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
      const isStored = storage.getItem(PLAN_KEY) !== null;
      const plan = readStored(storage);
      if (plan === "newer-version") return plan;
      current = isStored ? plan : undefined;
      return { plan, isStored };
    },
    async save(_before, after) {
      if (isNewerStored(storage)) return "newer-version";
      storage.setItem(PLAN_KEY, planFile.serialize(after));
      current = after;
      return "saved";
    },
    async exportFile() {
      const plan = readStored(storage, current);
      if (plan === "newer-version") return plan;
      return jsonFile.create(plan, Temporal.Now.plainDateISO());
    },
    async importFile(file) {
      const plan = await jsonFile.read(file);
      if (typeof plan === "string") return plan;
      if (isNewerStored(storage)) return "newer-version";
      storage.setItem(PLAN_KEY, planFile.serialize(plan));
      current = plan;
      return "imported";
    },
    async wipe() {
      storage.removeItem(PLAN_KEY);
      current = undefined;
      return "wiped";
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
