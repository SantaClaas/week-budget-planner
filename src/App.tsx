import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";

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
    void (async () => {
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
      setStore(opened);
      setPlan(loaded);
      Object.assign(window, { weekBudgetPlanner: { store: opened } });
      opened.onExternalChange(() => {
        void opened.load().then(({ plan: changed }) => setPlan(changed));
      });
    })();
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
    </main>
  );
}
