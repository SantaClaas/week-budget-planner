import * as local from "./local.ts";
import * as memory from "./memory.ts";
import type { Result } from "../result.ts";
import type { PlanStore } from "./plan-store.ts";

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

type DatabaseModule = typeof import("./database.ts");

/** The next level down after the database failed to open, saying so when its file exists. */
async function openFallbackAfter(error: unknown, database: DatabaseModule): Promise<PlanStore> {
  console.warn("[storage] the database couldn't be opened, using limited storage", error);
  const fallback = openFallback();
  // No file means the browser refused the database, as in a private window: nothing to report.
  if (!(await database.hasDatabaseFile())) return fallback;
  const { removeBrokenDatabase } = database;
  return {
    ...fallback,
    fallbackReason: "database-broken",
    async wipe() {
      const wiped = await fallback.wipe();
      if (wiped === "newer-version") return wiped;
      removeBrokenDatabase();
      return "wiped";
    },
  };
}

/**
 * Opens the best storage this browser allows, falling back a level when one can't be used or fails
 * to open (for example OPFS refusing access in a private window). Never blocks the UI for long: the
 * caller shows "Opening your plan…" until this resolves.
 *
 * "newer-version" when a newer version of the app saved the database. That isn't a fallback case:
 * the plan is fine, and only reloading to update the app can open it.
 */
export async function open(): Promise<Result<PlanStore, "newer-version">> {
  if (!isDatabaseUsable()) return openFallback();
  let database: DatabaseModule;
  try {
    database = await import("./database.ts");
  } catch (error) {
    // Without its chunk the database never opened, so there's no broken file to report.
    console.warn("[storage] the database code didn't load, using limited storage", error);
    return openFallback();
  }
  const store = database.create();
  let loaded: Awaited<ReturnType<PlanStore["load"]>>;
  try {
    loaded = await store.load();
  } catch (error) {
    return openFallbackAfter(error, database);
  }
  return loaded === "newer-version" ? loaded : store;
}
