import { databaseService, getDatabase } from "../database/client";
import { loadPlan, savePlan } from "../database/plan-repository";
import { broadcastMessage, listenForBroadcasts } from "../broadcast";
import * as planFile from "../plan/file";
import * as jsonFile from "./json-file";
import type { PlanStore } from "./plan-store";

/** The full level: the SQLite database in OPFS, shared by every tab through the leader. */
export function create(): PlanStore {
  const database = getDatabase();
  return {
    level: "full",
    load: () => loadPlan(database),
    async save(before, after) {
      await savePlan(database, before, after);
      broadcastMessage({ type: "Plan changed" });
    },
    async exportFile() {
      const bytes = await databaseService.exportFile();
      return {
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.sqlite3" }),
        filename: `week-budget-planner-${planFile.formatLocalDate()}.db`,
      };
    },
    async importFile(file) {
      if (jsonFile.isJson(file)) {
        // A plan exported at a limited level: replace the stored plan with it.
        const { plan: current } = await loadPlan(database);
        await savePlan(database, current, planFile.parse(await file.text()));
        broadcastMessage({ type: "Plan changed" });
        return;
      }
      // The leader writes the file to OPFS and reloads every tab, including this one.
      await databaseService.importFile(new Uint8Array(await file.arrayBuffer()));
    },
    wipe: () => databaseService.wipe(),
    onExternalChange(callback) {
      return listenForBroadcasts(() => callback());
    },
  };
}
