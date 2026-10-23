import * as local from "./local.ts";
import * as memory from "./memory.ts";
import { NewerVersionError, type PlanStore } from "./plan-store.ts";

/** Whether this page can run the SQLite database: isolation, OPFS, Web Locks and BroadcastChannel. */
function isDatabaseUsable(): boolean {
  return (
    globalThis.crossOriginIsolated &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof navigator.locks?.request === "function" &&
    typeof BroadcastChannel !== "undefined"
  );
}

/** The limited level, or none when localStorage can't be written. */
function openFallback(): PlanStore {
  const storage = local.findWritableStorage();
  return storage ? local.create(storage, window) : memory.create();
}

/** Whether a newer version of the app made the database, somewhere in the chain of causes. */
function isFromNewerVersion(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause.name === "NewerDatabaseError") return true;
  }
  return false;
}

/**
 * Opens the best storage this browser allows, falling back a level when one can't be used or fails
 * to open (for example OPFS refusing access in a private window). Never blocks the UI for long: the
 * caller shows "Opening your plan…" until this resolves.
 *
 * Rejects with {@link NewerVersionError} when a newer version of the app saved the database. That
 * isn't a fallback case: the plan is fine, and only reloading to update the app can open it.
 */
export async function open(): Promise<PlanStore> {
  if (!isDatabaseUsable()) return openFallback();
  let database: typeof import("./database.ts") | undefined;
  try {
    database = await import("./database.ts");
    const store = database.create();
    await store.load();
    return store;
  } catch (error) {
    if (isFromNewerVersion(error)) {
      throw new NewerVersionError(
        "Your plan was saved by a newer version of Week Budget Planner. Reload to update the app.",
        { cause: error },
      );
    }
    console.warn("[storage] the database couldn't be opened, using limited storage", error);
    const fallback = openFallback();
    // No file means the browser refused the database, as in a private window: nothing to report.
    if (!database || !(await database.hasDatabaseFile())) return fallback;
    const { removeBrokenDatabase } = database;
    return {
      ...fallback,
      fallbackReason: "database-broken",
      async wipe() {
        await fallback.wipe();
        removeBrokenDatabase();
      },
    };
  }
}
