import { databaseService, getDatabase } from "../database/client";
import { loadPlan, loadTheme, savePlan, saveTheme } from "../database/plan-repository";
import { broadcastMessage, listenForBroadcasts } from "../lib/broadcast";
import { localDate, parsePlan } from "../lib/plan-file";
import { isPlanJson, type PlanStore } from "./plan-store";

/** The full level: the SQLite database in OPFS, shared by every tab through the leader. */
export function databaseStore(): PlanStore {
  const database = getDatabase();
  return {
    level: "full",
    load: () => loadPlan(database),
    async save(before, after) {
      await savePlan(database, before, after);
      broadcastMessage({ type: "Plan changed" });
    },
    loadTheme: () => loadTheme(database),
    async saveTheme(theme) {
      await saveTheme(database, theme);
      broadcastMessage({ type: "Theme changed" });
    },
    async exportFile() {
      const bytes = await databaseService.exportFile();
      return {
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.sqlite3" }),
        filename: `week-budget-planner-${localDate()}.db`,
      };
    },
    async importFile(file) {
      if (isPlanJson(file)) {
        // A plan exported at a limited level: replace the stored plan with it.
        const { plan: current } = await loadPlan(database);
        await savePlan(database, current, parsePlan(await file.text()));
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
