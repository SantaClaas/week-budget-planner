import { databaseService, getDatabase } from "../database/client";

export { hasDatabaseFile, removeBrokenDatabase } from "../database/client";
import { loadPlan, savePlan } from "../database/plan-repository";
import { broadcastMessage, listenForBroadcasts } from "../broadcast";
import * as jsonFile from "./json-file";
import { InvalidFileError, NewerVersionError, type PlanStore } from "./plan-store";

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
        filename: `week-budget-planner-${Temporal.Now.plainDateISO()}.db`,
      };
    },
    async importFile(file) {
      if (jsonFile.isJson(file)) {
        // A plan exported at a limited level: replace the stored plan with it.
        const imported = await jsonFile.read(file);
        const { plan: current } = await loadPlan(database);
        await savePlan(database, current, imported);
        broadcastMessage({ type: "Plan changed" });
        return;
      }
      // The leader checks the file, writes it to OPFS and reloads every tab, including this one.
      const result = await databaseService.importFile(new Uint8Array(await file.arrayBuffer()));
      if (result === "invalid-file") {
        throw new InvalidFileError("This file isn't a Week Budget Planner database, so nothing was changed.");
      }
      if (result === "newer-version") {
        throw new NewerVersionError("This file is from a newer version of Week Budget Planner. Reload to update the app, then import it again.");
      }
    },
    wipe: () => databaseService.wipe(),
    onExternalChange(callback) {
      return listenForBroadcasts(() => callback());
    },
  };
}
