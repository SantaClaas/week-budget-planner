import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import version from "virtual:app-version";

import { createExampleWeek } from "./plan/example.ts";
import type { Plan } from "./plan/types.ts";
import { open as openStorage } from "./storage/index.ts";
import { NewerVersionError, type PlanStore } from "./storage/plan-store.ts";

// Placeholder until the UI lands (phase 4): opens storage, loads the example week on first run, and
// shows what it found. `window.weekBudgetPlanner` is a temporary hook for the browser checks.
export function App(): JSX.Element {
  const [store, setStore] = createSignal<PlanStore>();
  const [plan, setPlan] = createSignal<Plan>();
  const [problem, setProblem] = createSignal<"newer-version">();

  onSettled(() => {
    let stopWatching: (() => void) | undefined;
    let isDisposed = false;
    // Only the latest reload is shown, so two quick changes in another tab can't leave the older
    // plan on screen when their loads finish out of order.
    let latestReload = 0;

    async function start(): Promise<void> {
      let opened: PlanStore;
      try {
        opened = await openStorage();
      } catch (error) {
        if (!(error instanceof NewerVersionError)) throw error;
        setProblem("newer-version");
        return;
      }
      const stored = await opened.load();
      const loaded = stored.isStored ? stored.plan : createExampleWeek();
      if (!stored.isStored) await opened.save(undefined, loaded);
      if (isDisposed) return;
      setStore(opened);
      setPlan(loaded);
      Object.assign(window, { weekBudgetPlanner: { store: opened } });
      stopWatching = opened.onExternalChange(() => {
        latestReload += 1;
        const reload = latestReload;
        const showLatest = async (): Promise<void> => {
          const { plan: changed } = await opened.load();
          if (reload === latestReload) setPlan(changed);
        };
        showLatest().catch((error: unknown) => {
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
      <Show when={store()} fallback={problem() ? undefined : <p>Opening your plan…</p>}>
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
