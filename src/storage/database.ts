import { databaseService, getDatabase, onNewerVersion } from "../database/client.ts";

export { hasDatabaseFile, removeBrokenDatabase } from "../database/client.ts";
import { runOnDatabase } from "../database/drizzle.ts";
import { loadPlan, savePlan } from "../database/plan-repository.ts";
import { randomIds } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { broadcastMessage, listenForBroadcasts } from "../broadcast/index.ts";
import type { Result } from "../result.ts";
import * as jsonFile from "./json-file.ts";
import { createExportName, type PlanStore } from "./plan-store.ts";

/** Replaces the stored plan with an imported one, as one save, and tells the other tabs. */
async function replacePlan(
  database: ReturnType<typeof getDatabase>,
  imported: Plan,
): Promise<Result<"imported", "newer-version">> {
  const now = Temporal.Now.instant();
  const replaced = await runOnDatabase(async () => {
    const { plan: current } = await loadPlan(database, randomIds);
    await savePlan(database, current, imported, now);
  });
  if (replaced === "newer-version") return replaced;
  broadcastMessage({ type: "plan-changed" });
  return "imported";
}

/** The full level: the SQLite database in OPFS, shared by every tab through the leader. */
export function create(): PlanStore {
  const database = getDatabase();
  return {
    level: "full",
    load: () => runOnDatabase(() => loadPlan(database, randomIds)),
    async save(before, after, now) {
      const saved = await runOnDatabase(() => savePlan(database, before, after, now));
      if (saved === "newer-version") return saved;
      broadcastMessage({ type: "plan-changed" });
      return "saved";
    },
    async exportFile() {
      const bytes = await databaseService.exportFile();
      if (bytes === "newer-version") return bytes;
      return {
        blob: new Blob([bytes], { type: "application/vnd.sqlite3" }),
        filename: createExportName(Temporal.Now.plainDateISO(), "db"),
      };
    },
    async importFile(file) {
      // A database file: the leader checks it, writes it to OPFS and reloads every tab, this one too.
      if (!jsonFile.isJson(file)) {
        return databaseService.importFile(new Uint8Array(await file.arrayBuffer()));
      }
      // A plan exported at a limited level: replace the stored plan with it.
      const imported = await jsonFile.read(file);
      if (typeof imported === "string") return imported;
      return replacePlan(database, imported);
    },
    wipe: () => databaseService.wipe(),
    onExternalChange(callback) {
      const stopListening = listenForBroadcasts(() => {
        callback();
      });
      // Stepping down for a newer version changes what this tab can load, so it counts too.
      const stopWatchingVersions = onNewerVersion(callback);
      return () => {
        stopListening();
        stopWatchingVersions();
      };
    },
  };
}
