/* oxlint-disable require-await, typescript/require-await -- PlanStore's methods are async so that a
   throw (localStorage full or blocked, for example) arrives as a rejection, like the database's. */
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import * as jsonFile from "./json-file.ts";
import type { PlanStore } from "./plan-store.ts";

/** The lowest level: the plan lives in memory only and is lost when the tab closes. */
export function create(): PlanStore {
  let plan: Plan | undefined;
  return {
    level: "none",
    async load() {
      return { plan: plan ?? createEmptyPlan(), isStored: plan !== undefined };
    },
    async save(_before, after) {
      plan = after;
      return "saved";
    },
    async exportFile() {
      return jsonFile.create(plan ?? createEmptyPlan(), Temporal.Now.plainDateISO());
    },
    async importFile(file) {
      const imported = await jsonFile.read(file);
      if (typeof imported === "string") return imported;
      plan = imported;
      return "imported";
    },
    async wipe() {
      plan = undefined;
      return "wiped";
    },
    onExternalChange() {
      // Nothing else can change a plan that only this tab holds.
      return () => {};
    },
  };
}
