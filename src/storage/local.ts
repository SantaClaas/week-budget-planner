/* oxlint-disable require-await, typescript/require-await -- PlanStore's methods are async so that a
   throw (localStorage full or blocked, for example) arrives as a rejection, like the database's. */
import * as planFile from "../plan/file";
import type { Plan } from "../plan/types";
import * as jsonFile from "./json-file";
import type { PlanStore } from "./plan-store";

export const PLAN_KEY = "week-budget-planner.plan";

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
      current = text === null ? undefined : planFile.parse(text);
      return { plan: current ?? planFile.parse("null"), isStored: text !== null };
    },
    async save(_before, after) {
      storage.setItem(PLAN_KEY, planFile.serialize(after));
      current = after;
    },
    async exportFile() {
      const text = storage.getItem(PLAN_KEY);
      return jsonFile.create(
        text === null ? (current ?? planFile.parse("null")) : planFile.parse(text),
      );
    },
    async importFile(file) {
      const plan = await jsonFile.read(file);
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

/** Whether localStorage can actually be written (it can be missing, or throw, when blocked). */
export function findWritableStorage(): Storage | undefined {
  try {
    const storage = globalThis.localStorage;
    const probe = `${PLAN_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return undefined;
  }
}
