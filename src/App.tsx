import { createSignal, onSettled, Show } from "solid-js";
import version from "virtual:app-version";

import { createExampleWeek } from "./plan/example";
import type { Plan } from "./plan/types";
import { open as openStorage } from "./storage";
import type { PlanStore } from "./storage/plan-store";

// Placeholder until the UI lands (phase 4): opens storage, loads the example week on first run, and
// shows what it found. `window.weekBudgetPlanner` is a temporary hook for the browser checks.
export function App() {
  const [store, setStore] = createSignal<PlanStore>();
  const [plan, setPlan] = createSignal<Plan>();

  onSettled(() => {
    void (async () => {
      const opened = await openStorage();
      let { plan: loaded, isStored } = await opened.load();
      if (!isStored) {
        loaded = createExampleWeek();
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
      <p>
        <a href={version.url} target="_blank" rel="noopener">
          Version {version.date}
          {version.commit === undefined ? "" : ` · ${version.commit.slice(0, 7)}`}
        </a>
      </p>
    </main>
  );
}
