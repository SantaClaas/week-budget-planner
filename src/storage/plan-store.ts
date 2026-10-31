import type { Plan } from "../plan/index.ts";
import type { Result } from "../result.ts";

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

/**
 * Why an imported file wasn't imported, with nothing changed (see Export, import and reset in
 * docs/spec/persistence.md):
 * - "invalid-file": it isn't a plan, or a database this app can open.
 * - "needs-database": a `.db` file, which only the full level can import.
 * - "newer-version": a newer version of the app made it; reloading updates the app.
 */
export type ImportProblem = "invalid-file" | "needs-database" | "newer-version";

/**
 * Where the plan is kept. Every method gives back "newer-version" instead of doing anything once a
 * newer version of the app saved the plan or runs in another tab (see "Tabs on different versions"
 * in docs/spec/persistence.md). A failure the caller can only report, such as a full disk or a
 * lost call to another tab, throws.
 */
export interface PlanStore {
  readonly level: StorageLevel;
  /**
   * Why this level is lower than the browser allows: "database-broken" when the database file
   * exists but fails to open (see Export, import and reset in docs/spec/persistence.md).
   */
  readonly fallbackReason?: "database-broken";
  /** `isStored` is false when nothing was ever saved here (first run). */
  load(): Promise<Result<{ plan: Plan; isStored: boolean }, "newer-version">>;
  /**
   * Saves one user action, `before` being what is stored now, and `now` when the action happened
   * (see "One action, one `now`" in docs/guidelines/principles.md).
   */
  save(
    before: Plan | undefined,
    after: Plan,
    now: Temporal.Instant,
  ): Promise<Result<"saved", "newer-version">>;
  /** The `.db` file at the full level, the `.json` plan file otherwise. */
  exportFile(): Promise<Result<ExportedFile, "newer-version">>;
  /**
   * Replaces the stored plan with an imported `.db` (full level only) or `.json` file, or says why
   * it changed nothing.
   */
  importFile(file: File): Promise<Result<"imported", ImportProblem>>;
  /** Deletes everything this level stored. */
  wipe(): Promise<Result<"wiped", "newer-version">>;
  /**
   * Calls back when another tab changed the plan.
   * @mustUse Gives back the function that stops it, which the caller calls when it's done.
   */
  onExternalChange(callback: () => void): () => void;
}
