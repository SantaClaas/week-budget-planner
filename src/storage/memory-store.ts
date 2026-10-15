import { parsePlan } from "../plan/file";
import type { Plan } from "../plan/types";
import type { Theme } from "../theme";
import { exportJsonFile, importJsonFile } from "./json-file";
import type { PlanStore } from "./plan-store";

/** The lowest level: the plan lives in memory only and is lost when the tab closes. */
export function memoryStore(): PlanStore {
  let plan: Plan | undefined;
  let theme: Theme = "system";
  return {
    level: "none",
    async load() {
      return { plan: plan ?? parsePlan("null"), stored: plan !== undefined };
    },
    async save(_before, after) {
      plan = after;
    },
    async loadTheme() {
      return theme;
    },
    async saveTheme(next) {
      theme = next;
    },
    async exportFile() {
      return exportJsonFile(plan ?? parsePlan("null"));
    },
    async importFile(file) {
      plan = await importJsonFile(file);
    },
    async wipe() {
      plan = undefined;
      theme = "system";
    },
    onExternalChange() {
      return () => undefined;
    },
  };
}
