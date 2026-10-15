import * as local from "./local";
import * as memory from "./memory";
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
 * Opens the best storage this browser allows, falling back a level when one can't be used or fails
 * to open (for example OPFS refusing access in a private window). Never blocks the UI for long: the
 * caller shows "Opening your plan…" until this resolves.
 */
export async function open(): Promise<PlanStore> {
  if (isDatabaseUsable()) {
    try {
      const database = await import("./database");
      const store = database.create();
      await store.load();
      return store;
    } catch (error) {
      console.warn("[storage] the database couldn't be opened, using limited storage", error);
    }
  }
  const storage = local.findWritableStorage();
  if (storage) return local.create(storage, window);
  return memory.create();
}
