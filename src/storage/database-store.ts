import { dbService, getDb } from "../db/client";
import { loadPlan, loadTheme, savePlan, saveTheme } from "../db/plan-repository";
import { broadcastMessage, listenForBroadcasts } from "../lib/broadcast";
import { localDate, parsePlan } from "../lib/plan-file";
import { isPlanJson, type PlanStore } from "./plan-store";

/** The full level: the SQLite database in OPFS, shared by every tab through the leader. */
export function databaseStore(): PlanStore {
  const db = getDb();
  return {
    level: "full",
    load: () => loadPlan(db),
    async save(before, after) {
      await savePlan(db, before, after);
      broadcastMessage({ type: "Plan changed" });
    },
    loadTheme: () => loadTheme(db),
    async saveTheme(theme) {
      await saveTheme(db, theme);
      broadcastMessage({ type: "Theme changed" });
    },
    async exportFile() {
      const bytes = await dbService.exportFile();
      return {
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.sqlite3" }),
        filename: `week-budget-planner-${localDate()}.db`,
      };
    },
    async importFile(file) {
      if (isPlanJson(file)) {
        // A plan exported at a limited level: replace the stored plan with it.
        const { plan: current } = await loadPlan(db);
        await savePlan(db, current, parsePlan(await file.text()));
        broadcastMessage({ type: "Plan changed" });
        return;
      }
      // The leader writes the file to OPFS and reloads every tab, including this one.
      await dbService.importFile(new Uint8Array(await file.arrayBuffer()));
    },
    wipe: () => dbService.wipe(),
    onExternalChange(callback) {
      return listenForBroadcasts(() => callback());
    },
  };
}
