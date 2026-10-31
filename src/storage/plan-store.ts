import type { Plan } from "../plan/index.ts";

/**
 * How much the browser lets the app save (see "Progressive enhancement" in
 * docs/spec/persistence.md):
 * - "full": the SQLite database in OPFS, shared by every tab, with `.db` export and import.
 * - "limited": JSON in localStorage, for example in a private window or without isolation.
 * - "none": memory only; nothing survives closing the tab.
 */
export type StorageLevel = "full" | "limited" | "none";

export type ExportedFile = { blob: Blob; filename: string };

/**
 * The name an export is saved under, for example `week-budget-planner-2026-10-15.db` (see Export,
 * import and reset in docs/spec/persistence.md). The date is the user's, taken by the store when
 * the export starts.
 */
export const createExportName = (today: Temporal.PlainDate, extension: "db" | "json"): string =>
  `week-budget-planner-${today.toString()}.${extension}`;

/** An imported file that isn't a plan this level can read. Nothing was changed. */
export class InvalidFileError extends Error {}

/**
 * The plan, or an imported file, was saved by a newer version of the app. Reloading updates the
 * app (see Export, import and reset in docs/spec/persistence.md). Nothing was changed.
 */
export class NewerVersionError extends Error {}

/**
 * Whether a newer version of the app made the database or runs in another tab, somewhere in the
 * chain of causes. Read by name, since the database's errors cross from the leader tab.
 */
export function isFromNewerVersion(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause.name === "NewerDatabaseError") return true;
  }
  return false;
}

export interface PlanStore {
  readonly level: StorageLevel;
  /**
   * Why this level is lower than the browser allows: "database-broken" when the database file
   * exists but fails to open (see Export, import and reset in docs/spec/persistence.md).
   */
  readonly fallbackReason?: "database-broken";
  /** `isStored` is false when nothing was ever saved here (first run). */
  load(): Promise<{ plan: Plan; isStored: boolean }>;
  /**
   * Saves one user action, `before` being what is stored now, and `now` when the action happened
   * (see "One action, one `now`" in docs/guidelines/principles.md).
   */
  save(before: Plan | undefined, after: Plan, now: Temporal.Instant): Promise<void>;
  /** The `.db` file at the full level, the `.json` plan file otherwise. */
  exportFile(): Promise<ExportedFile>;
  /**
   * Replaces the stored plan with an imported `.db` (full level only) or `.json` file. Changes
   * nothing and throws {@link InvalidFileError} when the file isn't a plan this level can read, or
   * {@link NewerVersionError} when a newer version of the app made it.
   */
  importFile(file: File): Promise<void>;
  /** Deletes everything this level stored. */
  wipe(): Promise<void>;
  /**
   * Calls back when another tab changed the plan.
   * @mustUse Gives back the function that stops it, which the caller calls when it's done.
   */
  onExternalChange(callback: () => void): () => void;
}
