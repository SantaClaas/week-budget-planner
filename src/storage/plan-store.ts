import type { Plan } from "../plan/types";
import type { Theme } from "../theme";

/**
 * How much the browser lets the app save (see "Progressive enhancement" in the spec):
 * - "full": the SQLite database in OPFS, shared by every tab, with `.db` export and import.
 * - "limited": JSON in localStorage, for example in a private window or without isolation.
 * - "none": memory only; nothing survives closing the tab.
 */
export type StorageLevel = "full" | "limited" | "none";

export type ExportedFile = { blob: Blob; filename: string };

export interface PlanStore {
  readonly level: StorageLevel;
  /** `stored` is false when nothing was ever saved here (first run). */
  load(): Promise<{ plan: Plan; stored: boolean }>;
  /** Saves one user action, `before` being what is stored now. */
  save(before: Plan | undefined, after: Plan): Promise<void>;
  loadTheme(): Promise<Theme>;
  saveTheme(theme: Theme): Promise<void>;
  /** The `.db` file at the full level, the `.json` plan file otherwise. */
  exportFile(): Promise<ExportedFile>;
  /** Replaces the stored plan with an imported `.db` (full level only) or `.json` file. */
  importFile(file: File): Promise<void>;
  /** Deletes everything this level stored. */
  wipe(): Promise<void>;
  /** Calls back when another tab changed the plan or the theme. Returns an unsubscribe function. */
  onExternalChange(callback: () => void): () => void;
}
