import type { JSX } from "@solidjs/web";
import { createSignal, flush, Match, onSettled, Show, Switch } from "solid-js";
import version from "virtual:app-version";

import { ActivitiesPage } from "./activity/ActivitiesPage.tsx";
import * as edit from "./activity/edit.ts";
import { LiveRegion } from "./announcement/LiveRegion.tsx";
import { NavigationBar } from "./navigation/NavigationBar.tsx";
import { NavigationRail } from "./navigation/NavigationRail.tsx";
import { follow } from "./page/history.ts";
import { createPath, createTitle, NAMES, type Page } from "./page/index.ts";
import { WeekPage } from "./page/WeekPage.tsx";
import { DragChip } from "./placing/DragChip.tsx";
import * as placing from "./placing/index.ts";
import { PLACING_TOOLBAR_ID, PlacingToolbar } from "./placing/PlacingToolbar.tsx";
import type { Activity } from "./plan/activity/index.ts";
import * as planner from "./planner/index.ts";
import * as snackbar from "./snackbar/index.ts";
import { Snackbar } from "./snackbar/Snackbar.tsx";
import { sanitizeDayIndex } from "./plan/time.ts";
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

/** Escape stops placing, wherever focus is, except in a field, where it belongs to the field. */
function stopPlacingOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || placing.current() === undefined || isInField(event.target)) return;
  placing.stop();
}

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
  // Today's weekday, read once as the app starts (Temporal's 1 for Monday is the week's 0).
  const today = sanitizeDayIndex(Temporal.Now.plainDateISO().dayOfWeek - 1);
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

  /**
   * The rail's "New activity": opens the form in the list on the page, the pane on Week or the
   * Activities page. From another page, it moves to the Activities page first.
   */
  function openNewActivity(): void {
    if (page() !== "week" && page() !== "activities") {
      history.pushState(null, "", createPath("activities", BASE));
      showPage("activities", "link");
    }
    edit.openNew();
  }

  /**
   * Placing from the Activities page moves to the week, where the slots are, and focus goes to the
   * placing toolbar, which says what's placing.
   */
  function showWeekForPlacing(): void {
    history.pushState(null, "", createPath("week", BASE));
    showPage("week", "link");
    document.querySelector<HTMLElement>(`#${PLACING_TOOLBAR_ID}`)?.focus();
  }

  /**
   * Add block's "New activity…": opens the new-activity form, in the pane beside the week, or on
   * the Activities page on phones, where the pane isn't shown. Once the activity is added, the form
   * closes, `onCreated` adds the block, and a phone goes back to the week to show it.
   */
  function openNewActivityForBlock(onCreated: (activity: Activity) => void): void {
    const isPaneHidden = matchMedia("(width < 52.5em)").matches;
    if (isPaneHidden) {
      history.pushState(null, "", createPath("activities", BASE));
      showPage("activities", "link");
    }
    edit.openNewThen((activity) => {
      edit.close();
      if (isPaneHidden) {
        history.pushState(null, "", createPath("week", BASE));
        showPage("week", "link");
      }
      onCreated(activity);
    });
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
    document.addEventListener("keydown", stopPlacingOnEscape);
    return () => {
      document.removeEventListener("keydown", undoOnShortcut);
      document.removeEventListener("keydown", stopPlacingOnEscape);
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
      setCurrent(result.planner);
      // A hook for the browser tests, which still drive the store directly in places.
      Object.assign(window, {
        weekBudgetPlanner: { store: result.store, planner: result.planner },
      });
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
      <NavigationRail current={page()} base={BASE} onNewActivity={openNewActivity} />
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
          <Show when={current()} fallback={<p class="page-content">Opening your plan…</p>}>
            {(opened) => (
              <Switch>
                <Match when={page() === "week"}>
                  <WeekPage
                    plan={opened().plan()}
                    planner={opened()}
                    today={today}
                    onNewActivity={openNewActivityForBlock}
                  />
                </Match>
                <Match when={page() === "activities"}>
                  <ActivitiesPage
                    plan={opened().plan()}
                    planner={opened()}
                    onStartPlacing={showWeekForPlacing}
                  />
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
      <Show when={current()}>
        {(opened) => (
          <>
            {/* Placing picks slots on the week, so its toolbar shows with the week. */}
            <Show when={page() === "week"}>
              <PlacingToolbar plan={opened().plan()} planner={opened()} />
            </Show>
            <DragChip plan={opened().plan()} />
          </>
        )}
      </Show>
      <NavigationBar current={page()} base={BASE} />
      <LiveRegion />
      <Snackbar />
    </Show>
  );
}
