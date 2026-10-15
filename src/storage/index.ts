import { localStorageStore, usableLocalStorage } from "./local-storage-store";
import { memoryStore } from "./memory-store";
import type { PlanStore } from "./plan-store";

/** Whether this page can run the SQLite database: isolation, OPFS, Web Locks and BroadcastChannel. */
function canUseDatabase(): boolean {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof navigator.locks?.request === "function" &&
    typeof BroadcastChannel !== "undefined"
  );
}

/**
 * Opens the best storage this browser allows, falling back a level when one can't be used or fails
 * to open (for example OPFS refusing access in a private window). Never blocks the UI for long: the
 * caller shows "Opening your plan…" until this resolves.
 */
export async function openPlanStore(): Promise<PlanStore> {
  if (canUseDatabase()) {
    try {
      const { databaseStore } = await import("./database-store");
      const store = databaseStore();
      await store.load();
      return store;
    } catch (error) {
      console.warn("[storage] the database couldn't be opened, using limited storage", error);
    }
  }
  const storage = usableLocalStorage();
  if (storage) return localStorageStore(storage, window);
  return memoryStore();
}
