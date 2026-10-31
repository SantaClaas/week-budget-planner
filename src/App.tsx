import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import version from "virtual:app-version";

import { createExampleWeek } from "./plan/example.ts";
import { randomIds } from "./plan/id.ts";
import type { Plan } from "./plan/index.ts";
import { open as openStorage } from "./storage/index.ts";
import { NewerVersionError, type PlanStore } from "./storage/plan-store.ts";

/** Opens the best storage and loads the plan, which may turn out to be from a newer version. */
async function openAndLoad() {
  const opened = await openStorage();
  return { store: opened, stored: await opened.load() };
}

/** A tab no one can see loses nothing by reloading into the new version. */
function reloadWhenHidden(): void {
  if (document.visibilityState === "hidden") location.reload();
}

// Placeholder until the UI lands (phase 4): opens storage, loads the example week on first run, and
// shows what it found. `window.weekBudgetPlanner` is a temporary hook for the browser checks.
export function App(): JSX.Element {
  const [store, setStore] = createSignal<PlanStore>();
  const [plan, setPlan] = createSignal<Plan>();
  /**
   * "newer-version": a newer version saved the plan before this tab started, so it shows nothing
   * else. "outdated": a tab on a newer version took over while this one ran, so it can't save, and
   * the plan stays on screen read-only until it reloads (see "Tabs on different versions" in
   * docs/spec/persistence.md). The UI disables every change while it's "outdated".
   */
  const [problem, setProblem] = createSignal<"newer-version" | "outdated">();

  /** Reloads now when hidden, else asks to reload and reloads once the tab is hidden. */
  function leaveForNewerVersion(): void {
    if (document.visibilityState === "hidden") {
      location.reload();
      return;
    }
    setProblem("outdated");
    document.addEventListener("visibilitychange", reloadWhenHidden);
  }

  onSettled(() => {
    let stopWatching: (() => void) | undefined;
    let isDisposed = false;
    // Only the latest reload is shown, so two quick changes in another tab can't leave the older
    // plan on screen when their loads finish out of order.
    let latestReload = 0;

    async function start(): Promise<void> {
      let opened: Awaited<ReturnType<typeof openAndLoad>>;
      try {
        opened = await openAndLoad();
      } catch (error) {
        if (!(error instanceof NewerVersionError)) throw error;
        setProblem("newer-version");
        return;
      }
      const { store: openedStore, stored } = opened;
      // The example week is marked as loaded at the same moment its rows are saved.
      const now = Temporal.Now.instant();
      const loaded = stored.isStored ? stored.plan : createExampleWeek(now, randomIds);
      if (!stored.isStored) await openedStore.save(undefined, loaded, now);
      if (isDisposed) return;
      setStore(openedStore);
      setPlan(loaded);
      Object.assign(window, { weekBudgetPlanner: { store: openedStore } });
      stopWatching = openedStore.onExternalChange(() => {
        latestReload += 1;
        const reload = latestReload;
        const showLatest = async (): Promise<void> => {
          const { plan: changed } = await openedStore.load();
          if (reload === latestReload) setPlan(changed);
        };
        showLatest().catch((error: unknown) => {
          if (error instanceof NewerVersionError) {
            leaveForNewerVersion();
            return;
          }
          // The plan on screen stays as it was; the next change in another tab tries again.
          console.error("[app] couldn't reload the plan another tab changed", error);
        });
      });
    }

    // Opening falls back to a lower storage level by itself, so an error here is a bug. There's no
    // screen for it until the UI lands (phase 4), so it goes to the console.
    start().catch((error: unknown) => {
      console.error("[app] couldn't open the plan", error);
    });
    return () => {
      isDisposed = true;
      stopWatching?.();
      document.removeEventListener("visibilitychange", reloadWhenHidden);
    };
  });

  return (
    <main>
      <h1>Week Budget Planner</h1>
      <Show when={problem() === "newer-version"}>
        <p data-testid="newer-version">
          Your plan was saved by a newer version of Week Budget Planner. Reload to update the app.
          Your plan is safe.
        </p>
        <button
          type="button"
          onClick={() => {
            location.reload();
          }}
        >
          Reload
        </button>
      </Show>
      <Show when={problem() === "outdated"}>
        {/* The snackbar of the real UI (phase 4), which stays until Reload. */}
        <div>
          {/* An output is a polite live region, which announces the text once. */}
          <output data-testid="outdated">
            Week Budget Planner was updated in another tab. This tab can't save until it reloads.
          </output>
          <button
            type="button"
            onClick={() => {
              location.reload();
            }}
          >
            Reload
          </button>
        </div>
      </Show>
      <Show
        when={problem() === "newer-version" ? undefined : store()}
        fallback={problem() ? undefined : <p>Opening your plan…</p>}
      >
        {(opened) => (
          <p data-testid="status">
            Storage: {opened().level} · {plan()?.activities.length ?? 0} activities ·{" "}
            {plan()?.blocks.length ?? 0} blocks
          </p>
        )}
      </Show>
      <p>
        <a href={version.url} target="_blank" rel="noopener">
          Version {version.date}
          {version.commit === undefined ? "" : ` · ${version.commit.slice(0, 7)}`}
        </a>
      </p>
    </main>
  );
}
