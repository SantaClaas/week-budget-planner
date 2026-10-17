import * as local from "./local";
import * as memory from "./memory";
import * as persistence from "./persistence";
import type { PlanStore } from "./plan-store";

/** Whether this page can run the SQLite database: isolation, OPFS, Web Locks and BroadcastChannel. */
function isDatabaseUsable(): boolean {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof navigator.locks?.request === "function" &&
    typeof BroadcastChannel !== "undefined"
  );
}

/**
 * Asks for persistent storage after the first saved change to the user's own plan: not the
 * first-run save, and not while the example week is shown (see Keeping the data in docs/SPEC.md).
 */
function requestPersistenceOnFirstChange(store: PlanStore): PlanStore {
  let isRequested = false;
  return {
    ...store,
    async save(before, after) {
      await store.save(before, after);
      if (isRequested || before === undefined || after.exampleLoadedAt !== null) return;
      isRequested = true;
      void persistence.request();
    },
  };
}

/** The limited level, or none when localStorage can't be written. */
function openFallback(): PlanStore {
  const storage = local.findWritableStorage();
  return storage ? requestPersistenceOnFirstChange(local.create(storage, window)) : memory.create();
}

/**
 * Opens the best storage this browser allows, falling back a level when one can't be used or fails
 * to open (for example OPFS refusing access in a private window). Never blocks the UI for long: the
 * caller shows "Opening your plan…" until this resolves.
 */
export async function open(): Promise<PlanStore> {
  if (!isDatabaseUsable()) return openFallback();
  let database: typeof import("./database") | undefined;
  try {
    database = await import("./database");
    const store = database.create();
    await store.load();
    return requestPersistenceOnFirstChange(store);
  } catch (error) {
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
