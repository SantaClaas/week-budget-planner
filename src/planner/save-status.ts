import type { StorageLevel } from "../storage/plan-store.ts";

/** Where the latest save is: still running, done, or failed. */
export type SaveState = "saving" | "saved" | "failed";

/**
 * What the top app bar's save status shows (see Writes and undo in docs/spec/persistence.md):
 * its text, its icon, and its variant, "saved" for the database, "limited" for the lower levels'
 * saves and while saving, "not-saved" when the plan isn't kept.
 */
type SaveStatus = {
  text: string;
  icon: "cloud_done" | "sync" | "cloud_off";
  variant: "saved" | "limited" | "not-saved";
};

const NOT_SAVED: SaveStatus = { text: "Not saved", icon: "cloud_off", variant: "not-saved" };

/**
 * The status for the storage level and the latest save. An outdated tab (see Tabs on different
 * versions in docs/spec/persistence.md) can't save, whatever its level.
 */
export function describe(level: StorageLevel, state: SaveState, isOutdated: boolean): SaveStatus {
  if (isOutdated || state === "failed" || level === "none") return NOT_SAVED;
  if (state === "saving") return { text: "Saving…", icon: "sync", variant: "limited" };
  return level === "full"
    ? { text: "Saved in this browser", icon: "cloud_done", variant: "saved" }
    : { text: "Saved in limited storage", icon: "cloud_done", variant: "limited" };
}
