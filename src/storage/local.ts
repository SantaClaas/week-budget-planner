import * as planFile from "../plan/file";
import type { Plan } from "../plan/types";
import { isTheme } from "../theme";
import * as jsonFile from "./json-file";
import type { PlanStore } from "./plan-store";

export const PLAN_KEY = "week-budget-planner.plan";
export const THEME_KEY = "week-budget-planner.theme";

/**
 * The limited level: the plan as JSON in localStorage (the stored format of
 * examples/example-week.json). Other tabs pick up changes through the `storage` event; the last
 * write wins.
 */
export function create(storage: Storage, events: Pick<Window, "addEventListener" | "removeEventListener">): PlanStore {
  let current: Plan | undefined;
  return {
    level: "limited",
    async load() {
      const text = storage.getItem(PLAN_KEY);
      current = text === null ? undefined : planFile.parse(text);
      return { plan: current ?? planFile.parse("null"), stored: text !== null };
    },
    async save(_before, after) {
      storage.setItem(PLAN_KEY, planFile.serialize(after));
      current = after;
    },
    async loadTheme() {
      const theme = storage.getItem(THEME_KEY);
      return isTheme(theme) ? theme : "system";
    },
    async saveTheme(theme) {
      storage.setItem(THEME_KEY, theme);
    },
    async exportFile() {
      const text = storage.getItem(PLAN_KEY);
      return jsonFile.create(text === null ? (current ?? planFile.parse("null")) : planFile.parse(text));
    },
    async importFile(file) {
      const plan = await jsonFile.read(file);
      storage.setItem(PLAN_KEY, planFile.serialize(plan));
      current = plan;
    },
    async wipe() {
      storage.removeItem(PLAN_KEY);
      storage.removeItem(THEME_KEY);
      current = undefined;
    },
    onExternalChange(callback) {
      const listener = (event: StorageEvent) => {
        if (event.key === null || event.key === PLAN_KEY || event.key === THEME_KEY) callback();
      };
      events.addEventListener("storage", listener as EventListener);
      return () => events.removeEventListener("storage", listener as EventListener);
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
