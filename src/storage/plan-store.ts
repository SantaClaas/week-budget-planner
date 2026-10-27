import type { Plan } from "../plan/types.ts";

/**
 * How much the browser lets the app save (see "Progressive enhancement" in
 * docs/spec/persistence.md):
 * - "full": the SQLite database in OPFS, shared by every tab, with `.db` export and import.
 * - "limited": JSON in localStorage, for example in a private window or without isolation.
 * - "none": memory only; nothing survives closing the tab.
 */
type StorageLevel = "full" | "limited" | "none";

export type ExportedFile = { blob: Blob; filename: string };

/** An imported file that isn't a plan this level can read. Nothing was changed. */
export class InvalidFileError extends Error {}

/**
 * The plan, or an imported file, was saved by a newer version of the app. Reloading updates the
 * app (see Export, import and reset in docs/spec/persistence.md). Nothing was changed.
 */
export class NewerVersionError extends Error {}

export interface PlanStore {
  readonly level: StorageLevel;
  /**
   * Why this level is lower than the browser allows: "database-broken" when the database file
   * exists but fails to open (see Export, import and reset in docs/spec/persistence.md).
   */
  readonly fallbackReason?: "database-broken";
  /** `isStored` is false when nothing was ever saved here (first run). */
  load(): Promise<{ plan: Plan; isStored: boolean }>;
  /** Saves one user action, `before` being what is stored now. */
  save(before: Plan | undefined, after: Plan): Promise<void>;
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
