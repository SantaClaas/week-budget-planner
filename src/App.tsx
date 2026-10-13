import { createSignal, onSettled, Show } from "solid-js";

import { sanitizePlan } from "./plan/sanitize";
import type { Plan } from "./plan/types";
import exampleWeek from "../examples/example-week.json";
import { openPlanStore } from "./storage/open-store";
import type { PlanStore } from "./storage/plan-store";

// Placeholder until the UI lands (phase 4): opens storage, loads the example week on first run, and
// shows what it found. `window.weekBudgetPlanner` is a temporary hook for the browser checks.
export function App() {
  const [store, setStore] = createSignal<PlanStore>();
  const [plan, setPlan] = createSignal<Plan>();

  onSettled(() => {
    void (async () => {
      const opened = await openPlanStore();
      let { plan: loaded, stored } = await opened.load();
      if (!stored) {
        loaded = sanitizePlan(exampleWeek);
        await opened.save(undefined, loaded);
      }
      setStore(opened);
      setPlan(loaded);
      Object.assign(window, { weekBudgetPlanner: { store: opened } });
      opened.onExternalChange(async () => setPlan((await opened.load()).plan));
    })();
  });

  return (
    <main>
      <h1>Week Budget Planner</h1>
      <Show when={store()} fallback={<p>Opening your plan…</p>}>
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
