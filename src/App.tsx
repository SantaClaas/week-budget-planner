import type { JSX } from "@solidjs/web";
import { createSignal, flush, Match, onSettled, Show, Switch } from "solid-js";
import version from "virtual:app-version";

import { LiveRegion } from "./announcement/LiveRegion.tsx";
import { NavigationBar } from "./navigation/NavigationBar.tsx";
import { NavigationRail } from "./navigation/NavigationRail.tsx";
import { follow } from "./page/history.ts";
import { createPath, createTitle, NAMES, type Page } from "./page/index.ts";
import * as planner from "./planner/index.ts";
import * as snackbar from "./snackbar/index.ts";
import { Snackbar } from "./snackbar/Snackbar.tsx";
import type { PlanStore } from "./storage/plan-store.ts";
import { TopAppBar } from "./top-app-bar/TopAppBar.tsx";

/** The path the app is served from, `/week-budget-planner/` (see vite.config.ts). */
const BASE = import.meta.env.BASE_URL;

/** A tab no one can see loses nothing by reloading into the new version. */
function reloadWhenHidden(): void {
  if (document.visibilityState === "hidden") location.reload();
}

/** Whether a key press goes to a field, where Ctrl/Cmd+Z undoes typing instead of a change. */
const isInField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, select, textarea"));

/**
 * A tab on a newer version took over while this one ran, and the planner stopped every change:
 * reloads now when hidden, else asks to reload with the plan on screen read-only, and reloads once
 * the tab is hidden.
 */
function leaveForNewerVersion(): void {
  if (document.visibilityState === "hidden") {
    location.reload();
    return;
  }
  snackbar.show({
    message:
      "Week Budget Planner was updated in another tab. This tab can't save until it reloads.",
    isLasting: true,
    action: {
      label: "Reload",
      run: () => {
        location.reload();
      },
    },
  });
  document.addEventListener("visibilitychange", reloadWhenHidden);
}

/** The full page when a newer version saved the plan: nothing else can be shown or changed. */
function NewerVersionPage(): JSX.Element {
  return (
    <main class="newer-version" data-testid="newer-version">
      <h1 id="newer-version-title" class="headline-small">
        Your plan was saved by a newer version
      </h1>
      <p id="newer-version-text" class="body-large">
        Reload to update Week Budget Planner. Your plan is safe, and nothing was changed.
      </p>
      <button
        type="button"
        class="button"
        data-variant="filled"
        aria-describedby="newer-version-title newer-version-text"
        onClick={() => {
          location.reload();
        }}
      >
        Reload
      </button>
    </main>
  );
}

/** The page for an address with no page: says so, and leads to the week. */
function NotFound(): JSX.Element {
  return (
    <div class="page-content">
      <p class="body-large">There's no page at this address.</p>
      <a href={createPath("week", BASE)}>Go to the week</a>
    </div>
  );
}

/**
 * The app: the navigation, the page the address names, the live regions and the snackbar. It opens
 * storage, loads the example week on first run, and follows changes from other tabs.
 */
export function App(): JSX.Element {
  const [page, setPage] = createSignal<Page>("week");
  const [store, setStore] = createSignal<PlanStore>();
  const [current, setCurrent] = createSignal<planner.Planner>();
  /**
   * A newer version saved the plan before this tab started, so it shows nothing else (see "Tabs on
   * different versions" in docs/spec/persistence.md).
   */
  const [isFromNewerVersion, setIsFromNewerVersion] = createSignal(false);
  let heading: HTMLHeadingElement | undefined;

  /** Shows the page, and on a move from a link takes focus to its heading, so it's read out. */
  function showPage(shown: Page, cause: "link" | "history"): void {
    setPage(shown);
    document.title = createTitle(shown);
    if (cause === "history") return;
    // The new page renders now, so its heading and the section the address names are in place.
    flush();
    heading?.focus();
    if (location.hash === "") return;
    document.querySelector(`#${CSS.escape(location.hash.slice(1))}`)?.scrollIntoView();
  }

  const undoOnShortcut = (event: KeyboardEvent): void => {
    const isShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
    if (!isShortcut || event.key.toLowerCase() !== "z" || isInField(event.target)) return;
    event.preventDefault();
    current()?.undo();
  };

  onSettled(() => follow(BASE, showPage));

  onSettled(() => {
    document.addEventListener("keydown", undoOnShortcut);
    return () => {
      document.removeEventListener("keydown", undoOnShortcut);
    };
  });

  onSettled(() => {
    let opened: planner.Planner | undefined;
    let isDisposed = false;

    async function start(): Promise<void> {
      const result = await planner.open({
        showSnackbar: snackbar.show,
        onNewerVersion: leaveForNewerVersion,
      });
      if (result === "newer-version") {
        setIsFromNewerVersion(true);
        return;
      }
      if (isDisposed) {
        result.planner.stop();
        return;
      }
      opened = result.planner;
      setStore(result.store);
      setCurrent(result.planner);
      // A hook for the browser tests, which still drive the store directly in places.
      Object.assign(window, { weekBudgetPlanner: { store: result.store } });
    }

    // Opening falls back to a lower storage level by itself, so an error here is a bug.
    start().catch((error: unknown) => {
      console.error("[app] couldn't open the plan", error);
    });
    return () => {
      isDisposed = true;
      opened?.stop();
      document.removeEventListener("visibilitychange", reloadWhenHidden);
    };
  });

  return (
    <Show when={!isFromNewerVersion()} fallback={<NewerVersionPage />}>
      <NavigationRail current={page()} base={BASE} />
      <main>
        <TopAppBar
          title={NAMES[page()]}
          base={BASE}
          planner={current()}
          headingRef={(element) => {
            heading = element;
          }}
        />
        {/* An address with no page needs no plan, so it shows at once. */}
        <Show when={page() !== "not-found"} fallback={<NotFound />}>
          <Show when={store()} fallback={<p class="page-content">Opening your plan…</p>}>
            {(opened) => (
              <Switch>
                <Match when={page() === "week"}>
                  {/* The week arrives in the next step of phase 4; until then, what was loaded. */}
                  <p class="page-content" data-testid="status">
                    Storage: {opened().level} · {current()?.plan().activities.length ?? 0}{" "}
                    activities · {current()?.plan().blocks.length ?? 0} blocks
                  </p>
                </Match>
                <Match when={page() === "activities"}>
                  <p class="page-content">The activities arrive in a later step of phase 4.</p>
                </Match>
                <Match when={page() === "settings"}>
                  <section class="page-content" aria-labelledby="about-title">
                    <h2 id="about-title" class="title-medium emphasized">
                      About
                    </h2>
                    <a href={version.url} target="_blank" rel="noopener">
                      Version {version.date}
                      {version.commit === undefined ? "" : ` · ${version.commit.slice(0, 7)}`}
                    </a>
                  </section>
                </Match>
              </Switch>
            )}
          </Show>
        </Show>
      </main>
      <NavigationBar current={page()} base={BASE} />
      <LiveRegion />
      <Snackbar />
    </Show>
  );
}
