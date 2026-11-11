import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, flush, onSettled, Show } from "solid-js";

import { downloadBlob } from "../download.ts";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/name.ts";
import { formatCount } from "../plan/format.ts";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";
import * as snackbar from "../snackbar/index.ts";
import * as jsonFile from "../storage/json-file.ts";
import * as persistence from "../storage/persistence.ts";
import { createExportName, type ImportProblem, type PlanStore } from "../storage/plan-store.ts";
import { formatSize } from "./size.ts";

/** "5 activities and 8 blocks". */
const describeContents = (plan: Plan): string =>
  `${formatCount(plan.activities.length, { one: "activity", other: "activities" })} and ${formatCount(plan.blocks.length, { one: "block", other: "blocks" })}`;

/** Downloads the plan: the `.db` file at the full level, the `.json` plan file below it. */
async function exportPlan(store: PlanStore): Promise<void> {
  let exported: Awaited<ReturnType<PlanStore["exportFile"]>>;
  try {
    exported = await store.exportFile();
  } catch (error) {
    console.error("[settings] couldn't export the plan", error);
    snackbar.show({ message: "Couldn't export your plan. Try again." });
    return;
  }
  // A newer version took over in another tab, which this tab already says.
  if (exported === "newer-version") return;
  downloadBlob(exported.blob, exported.filename);
}

/** What the snackbar says when an import changed nothing (see Export, import and reset). */
function showImportProblem(problem: ImportProblem, file: File): void {
  if (problem === "newer-version") {
    snackbar.show({
      message:
        "This file is from a newer version of Week Budget Planner. Reload to update the app, then import it again.",
      action: {
        label: "Reload",
        run: () => {
          location.reload();
        },
      },
    });
    return;
  }
  if (problem === "needs-database") {
    snackbar.show({
      message: "This browser can only import a .json plan here, so nothing was changed.",
    });
    return;
  }
  snackbar.show({
    message: jsonFile.isJson(file)
      ? "This file isn't a Week Budget Planner plan, so nothing was changed."
      : "This file isn't a Week Budget Planner database, so nothing was changed.",
  });
}

/**
 * Replaces the plan with the file's, and reloads, so every part of the page starts from the new
 * plan (a `.db` import reloads every tab by itself). Says why when nothing was changed.
 */
async function importPlan(store: PlanStore, file: File): Promise<void> {
  let imported: Awaited<ReturnType<PlanStore["importFile"]>>;
  try {
    imported = await store.importFile(file);
  } catch (error) {
    console.error("[settings] couldn't import the file", error);
    snackbar.show({ message: "Couldn't import the file, so nothing was changed." });
    return;
  }
  if (imported !== "imported") {
    showImportProblem(imported, file);
    return;
  }
  location.reload();
}

/** Deletes everything this browser stored, and reloads (the database reloads every tab itself). */
async function deleteAllData(store: PlanStore): Promise<void> {
  let wiped: Awaited<ReturnType<PlanStore["wipe"]>>;
  try {
    wiped = await store.wipe();
  } catch (error) {
    console.error("[settings] couldn't delete the data", error);
    snackbar.show({ message: "Couldn't delete your data. Try again." });
    return;
  }
  if (wiped === "newer-version") return;
  location.reload();
}

/**
 * A question before something that can't be undone, as a modal `<dialog>` that's always in the
 * page: its title, what will happen (the paragraphs `describedBy` names, its own children), and
 * the action named for what it does. A button opens it with `commandfor` and `command="show-modal"`,
 * or the code with `showModal()`. Cancel, Escape and a click outside close it without doing
 * anything.
 */
function ConfirmDialog(properties: {
  id: string;
  title: string;
  /** The ids of the paragraphs that say what will happen, which the dialog is described by. */
  describedBy: string;
  children: JSX.Element;
  action: string;
  onConfirm: () => void;
  onClose?: () => void;
  ref?: (dialog: HTMLDialogElement) => void;
}): JSX.Element {
  return (
    <dialog
      id={properties.id}
      class="dialog"
      closedby="any"
      role="alertdialog"
      aria-labelledby={`${properties.id}-title`}
      aria-describedby={properties.describedBy}
      ref={(created) => {
        properties.ref?.(created);
      }}
      onClose={(event) => {
        // The form's buttons close the dialog with their value; Escape and a click outside don't.
        // The dialog stays in the page, so its value is cleared for the next time it opens.
        const isConfirmed = event.currentTarget.returnValue === "confirm";
        event.currentTarget.returnValue = "";
        if (isConfirmed) properties.onConfirm();
        properties.onClose?.();
      }}
    >
      <h2 id={`${properties.id}-title`} class="headline-small">
        {properties.title}
      </h2>
      {properties.children}
      <form method="dialog">
        <button type="submit" class="button" value="cancel" autofocus>
          Cancel
        </button>
        <button type="submit" class="button" value="confirm">
          {properties.action}
        </button>
      </form>
    </dialog>
  );
}

/** A notice about the storage this tab has, in the color of how much it matters. */
function Notice(properties: {
  id: string;
  variant: "error" | "information";
  icon: IconName;
  title: string;
  text: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <section
      class="notice"
      data-variant={properties.variant}
      aria-labelledby={`${properties.id}-title`}
    >
      <Icon name={properties.icon} />
      <h3 id={`${properties.id}-title`} class="title-medium emphasized">
        {properties.title}
      </h3>
      <p id={`${properties.id}-text`} class="body-medium">
        {properties.text}
      </p>
      <Show when={properties.children}>{(actions) => <footer>{actions()}</footer>}</Show>
    </section>
  );
}

/** What the "Keeping your plan" row says, and its icon, for each state. */
const KEEPING: Record<persistence.KeepingState, { icon: IconName; text: string }> = {
  persisted: { icon: "verified_user", text: "This browser keeps your plan until you delete it." },
  "not-persisted": {
    icon: "gpp_maybe",
    text: "This browser may delete your plan when it runs low on space. Export now and then to keep a copy.",
  },
  denied: {
    icon: "gpp_bad",
    text: "This browser didn't agree to keep your plan. Export now and then to keep a copy.",
  },
};

/**
 * Settings › Your data (see Export, import and reset, and Keeping the data, in
 * docs/spec/persistence.md): where the plan is kept and how safely, then export, import and
 * delete. The save status in the top app bar links here.
 */
export function YourData(properties: {
  plan: Plan;
  planner: Planner;
  store: PlanStore;
}): JSX.Element {
  const [keeping, setKeeping] = createSignal<persistence.KeepingState>();
  const [importing, setImporting] = createSignal<File>();
  let fileInput: HTMLInputElement | undefined;
  let importDialog: HTMLDialogElement | undefined;
  const isFull = (): boolean => properties.store.level === "full";
  const exportName = (): string =>
    createExportName(Temporal.Now.plainDateISO(), isFull() ? "db" : "json");
  const exportCurrent = (): void => {
    void exportPlan(properties.store);
  };
  const pickFile = (): void => {
    fileInput?.click();
  };
  const refreshKeeping = async (): Promise<void> => {
    setKeeping(await persistence.findState());
  };
  /** Asks the browser to keep the plan, from the user's own click, and says what it answered. */
  const keepPlan = async (): Promise<void> => {
    const isKept = await persistence.request();
    await refreshKeeping();
    snackbar.show(
      isKept
        ? { message: "This browser will keep your plan." }
        : {
            message:
              "This browser didn't agree to keep your plan. Export now and then to keep a copy.",
            action: { label: "Export", run: exportCurrent },
          },
    );
  };
  onSettled(() => {
    // findState() never rejects: each browser call in it falls back on failure.
    void refreshKeeping();
  });
  return (
    <section id="your-data" class="settings-section" aria-labelledby="your-data-title">
      <h2 id="your-data-title" class="title-small emphasized">
        Your data
      </h2>
      <p class="body-medium muted introduction">
        Your plan is stored only in this browser. Nothing is uploaded. Export it to keep a backup or
        to move it to another device.
      </p>
      <Show when={properties.planner.isOutdated()}>
        <Notice
          id="outdated-notice"
          variant="information"
          icon="refresh"
          title="Week Budget Planner was updated in another tab."
          text="This tab can't save until it reloads. Everything saved so far is safe."
        >
          <button
            type="button"
            class="button"
            data-variant="filled"
            aria-describedby="outdated-notice-title outdated-notice-text"
            onClick={() => {
              location.reload();
            }}
          >
            Reload
          </button>
        </Notice>
      </Show>
      <Show when={properties.store.fallbackReason === "database-broken"}>
        <Notice
          id="broken-database-notice"
          variant="error"
          icon="database"
          title="The database in this browser couldn't be opened"
          text="So your plan is in limited storage for now. Import a backup, or delete all data to start over."
        >
          <button
            type="button"
            class="button"
            data-variant="outlined"
            commandfor="delete-dialog"
            command="show-modal"
          >
            Delete all data
          </button>
          <button type="button" class="button" data-variant="filled" onClick={pickFile}>
            Import backup
          </button>
        </Notice>
      </Show>
      <Show
        when={properties.store.level === "limited" && properties.store.fallbackReason === undefined}
      >
        <Notice
          id="limited-notice"
          variant="information"
          icon="cloud_off"
          title="Your plan is in limited storage"
          text="This browser blocked the full database here, for example in a private window. Your plan is kept in simpler storage that the browser may clear, for example when the window closes. Export to keep a copy."
        />
      </Show>
      <Show when={properties.store.level === "none"}>
        <Notice
          id="no-storage-notice"
          variant="error"
          icon="cloud_off"
          title="Your plan isn't saved"
          text="This browser doesn't allow saving here. Your changes are lost when you close this tab. Export to keep them."
        />
      </Show>
      <ul class="segmented-list">
        <Show when={keeping()}>
          {(state) => (
            <li class="list-item keeping" data-state={state()}>
              <Icon name={KEEPING[state()].icon} />
              <span class="grow">
                <span class="body-large">Keeping your plan</span>
                <span id="keeping-text" class="body-medium muted">
                  {KEEPING[state()].text}
                </span>
              </span>
              <Show when={state() === "not-persisted"}>
                <button
                  type="button"
                  class="button"
                  data-variant="tonal"
                  aria-describedby="keeping-text"
                  onClick={() => {
                    void keepPlan();
                  }}
                >
                  Keep my plan
                </button>
              </Show>
            </li>
          )}
        </Show>
        <li>
          <button
            type="button"
            class="list-item"
            aria-labelledby="export-title"
            aria-describedby="export-text"
            onClick={exportCurrent}
          >
            <Icon name="download" />
            <span class="grow">
              <span id="export-title" class="body-large">
                {isFull() ? "Export database" : "Export plan"}
              </span>
              <span id="export-text" class="body-medium muted">
                Saves {exportName()}
              </span>
            </span>
            <Icon name="chevron_right" />
          </button>
        </li>
        <li>
          <button
            type="button"
            class="list-item"
            aria-labelledby="import-title"
            aria-describedby="import-text"
            onClick={pickFile}
          >
            <Icon name="upload" />
            <span class="grow">
              <span id="import-title" class="body-large">
                {isFull() ? "Import database" : "Import plan"}
              </span>
              <span id="import-text" class="body-medium muted">
                {isFull()
                  ? "Replaces the plan in this browser with a .db or .json file"
                  : "Replaces the plan in this browser with a .json file"}
              </span>
            </span>
            <Icon name="chevron_right" />
          </button>
          <input
            type="file"
            accept={
              isFull()
                ? ".db,.json,application/vnd.sqlite3,application/json"
                : ".json,application/json"
            }
            hidden
            ref={(created) => {
              fileInput = created;
            }}
            onChange={(event) => {
              const [file] = event.currentTarget.files ?? [];
              // The same file can be picked again after a cancelled import.
              event.currentTarget.value = "";
              if (file === undefined) return;
              // The picked file is only known now, so the code opens the dialog, once it names it.
              setImporting(file);
              flush();
              importDialog?.showModal();
            }}
          />
        </li>
        <li>
          <button
            type="button"
            class="list-item delete-all-data"
            aria-labelledby="delete-all-data-title"
            aria-describedby="delete-all-data-text"
            commandfor="delete-dialog"
            command="show-modal"
          >
            <Icon name="delete_forever" />
            <span class="grow">
              <span id="delete-all-data-title" class="body-large">
                Delete all data
              </span>
              <span id="delete-all-data-text" class="body-medium">
                Removes every activity and block from this browser
              </span>
            </span>
          </button>
        </li>
      </ul>
      <ConfirmDialog
        id="import-dialog"
        title="Replace your plan?"
        describedBy="import-dialog-replaces import-dialog-export"
        action="Replace"
        ref={(created) => {
          importDialog = created;
        }}
        onConfirm={() => {
          const file = importing();
          if (file !== undefined) void importPlan(properties.store, file);
        }}
        onClose={() => {
          setImporting(undefined);
        }}
      >
        <p id="import-dialog-replaces" class="body-medium muted">
          “{importing()?.name}” replaces the plan in this browser:{" "}
          {describeContents(properties.plan)}.
        </p>
        <p id="import-dialog-export" class="body-medium muted">
          To keep a copy of it,{" "}
          <button type="button" class="inline-link" onClick={exportCurrent}>
            export it first
          </button>
          .
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        id="delete-dialog"
        title="Delete all data?"
        describedBy="delete-dialog-text"
        action="Delete all data"
        onConfirm={() => {
          void deleteAllData(properties.store);
        }}
      >
        <p id="delete-dialog-text" class="body-medium muted">
          This removes your plan from this browser: {describeContents(properties.plan)}. It can't be
          undone, so export it first to keep a copy.
        </p>
      </ConfirmDialog>
    </section>
  );
}

/** Settings › Storage: what the plan holds, and how big the database is at the full level. */
export function Storage(properties: { plan: Plan; store: PlanStore }): JSX.Element {
  const [size, setSize] = createSignal<number>();
  const measure = async (): Promise<void> => {
    let measured: Awaited<ReturnType<PlanStore["measureSize"]>>;
    try {
      measured = await properties.store.measureSize();
    } catch (error) {
      console.error("[settings] couldn't measure the database", error);
      return;
    }
    setSize(typeof measured === "number" ? measured : undefined);
  };
  // Measured again after each change, which may have grown it.
  createEffect(
    () => properties.plan,
    () => {
      // measure() handles its own failure.
      void measure();
    },
  );
  return (
    <section class="settings-section" aria-labelledby="storage-title">
      <h2 id="storage-title" class="title-small emphasized">
        Storage
      </h2>
      <dl class="segmented-list">
        <div class="list-item">
          <dt class="body-large grow">Activities</dt>
          <dd class="body-large muted">{properties.plan.activities.length}</dd>
        </div>
        <div class="list-item">
          <dt class="body-large grow">Blocks</dt>
          <dd class="body-large muted">{properties.plan.blocks.length}</dd>
        </div>
        <Show when={size()}>
          {(bytes) => (
            <div class="list-item">
              <dt class="body-large grow">Database size</dt>
              <dd class="body-large muted">{formatSize(bytes())}</dd>
            </div>
          )}
        </Show>
      </dl>
    </section>
  );
}
