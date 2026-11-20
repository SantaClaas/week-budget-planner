import { databaseService, getDatabase, onNewerVersion } from "../database/client.ts";

export { hasDatabaseFile, removeBrokenDatabase } from "../database/client.ts";
import { runOnDatabase } from "../database/drizzle.ts";
import { createRandomNodeId } from "../database/node.ts";
import { loadPlan, saveAction } from "../database/plan-repository.ts";
import { replay } from "../merge/replay.ts";
import * as size from "../database/size.ts";
import { randomIds } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";
import { broadcastMessage, listenForBroadcasts } from "../broadcast/index.ts";
import type { Result } from "../result.ts";
import * as jsonFile from "./json-file.ts";
import { createExportName, type PlanStore } from "./plan-store.ts";

/**
 * The lock every tab's save holds while it reads the rows and writes the change, so no other save
 * lands in between: two would otherwise read the same rows and clock, and the later write would
 * undo the earlier one.
 */
const SAVE_LOCK = "week-budget-planner.save";

/**
 * Saves one action through the rows, under the save lock.
 *
 * @param update - The action: it gets the plan the rows show and gives back the plan after.
 */
const saveUnderLock = (
  database: ReturnType<typeof getDatabase>,
  update: (before: Plan) => Plan,
  now: Temporal.Instant,
): Promise<Result<Plan, "newer-version">> =>
  navigator.locks.request(SAVE_LOCK, () =>
    runOnDatabase(() => saveAction(database, update, now, createRandomNodeId)),
  );

/** Replaces the stored plan with an imported one, as one save, and tells the other tabs. */
async function replacePlan(
  database: ReturnType<typeof getDatabase>,
  imported: Plan,
): Promise<Result<"imported", "newer-version">> {
  const replaced = await saveUnderLock(database, () => imported, Temporal.Now.instant());
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
      // The rows may hold another tab's change made since `before`, so only what the action
      // changed is applied to them (see merge/replay.ts). Without a `before`, nothing is stored yet.
      const update = (stored: Plan): Plan =>
        before === undefined ? after : replay(stored, before, after);
      const saved = await saveUnderLock(database, update, now);
      if (saved === "newer-version") return saved;

      broadcastMessage({ type: "plan-changed" });
      return "saved";
    },
    async exportFile(at) {
      const bytes = await databaseService.exportFile();
      if (bytes === "newer-version") return bytes;

      return {
        blob: new Blob([bytes], { type: "application/vnd.sqlite3" }),
        filename: createExportName(at, "db"),
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
    measureSize: () => size.measure(databaseService),
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
