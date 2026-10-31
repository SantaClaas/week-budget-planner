// Helpers for the browser tests. Until the UI has every control (phase 4), the app exposes its plan
// store and its planner as window.weekBudgetPlanner, and the tests read and drive the plan through
// it where no control exists yet; as each control lands, they move to it.
import { expect, type Page } from "@playwright/test";

import type { PlanStore } from "../src/storage/plan-store.ts";

declare global {
  interface Window {
    // The planner's part these tests read. Its full type would pull the app's modules, Vite's
    // import.meta.glob among them, into the tests' own TypeScript project.
    weekBudgetPlanner?: {
      store: PlanStore;
      planner: { plan(): { activities: readonly unknown[]; blocks: readonly unknown[] } };
    };
  }
}

/** The app with the cross-origin isolation headers, as `vite preview` and hosts with headers serve it. */
export const ISOLATED_URL = "http://localhost:4311/week-budget-planner/";
/** The app without them, as GitHub Pages serves it: the service worker has to add them. */
export const PAGES_URL = "http://localhost:4312/week-budget-planner/";

/** The example week: 5 activities and 8 blocks. */
const EXAMPLE_WEEK = "5 activities · 8 blocks";

/**
 * Waits until the app has opened its plan at `level`, holding `plan` ("5 activities · 8 blocks"),
 * as its store and planner report them.
 */
export async function expectStatus(
  page: Page,
  level: "full" | "limited" | "none",
  plan = EXAMPLE_WEEK,
): Promise<void> {
  await expect
    .poll(() =>
      page
        .evaluate(() => {
          const opened = window.weekBudgetPlanner;
          if (opened === undefined) return "not open";
          const { activities, blocks } = opened.planner.plan();
          return `${opened.store.level} · ${activities.length.toString()} activities · ${blocks.length.toString()} blocks`;
        })
        // A reload in the middle of a check ends it, which counts as not yet.
        .catch(() => "reloading"),
    )
    .toBe(`${level} · ${plan}`);
}

/** Removes the plan's first block, as a user's change would. */
export async function removeFirstBlock(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = window.weekBudgetPlanner?.store;
    if (store === undefined) throw new Error("The app hasn't opened its storage.");
    const loaded = await store.load();
    if (loaded === "newer-version") throw new Error("A newer version saved the plan.");
    const { plan } = loaded;
    const saved = await store.save(
      plan,
      { ...plan, blocks: plan.blocks.slice(1) },
      Temporal.Now.instant(),
    );
    if (saved === "newer-version") throw new Error("A newer version saved the plan.");
  });
}

/**
 * Imports a file through the store. Resolves to why the import was refused ("invalid-file",
 * "needs-database", "newer-version"), or to "imported" once the page has reloaded with the
 * imported plan.
 */
export async function importFile(
  page: Page,
  name: string,
  bytes: readonly number[],
  type = "",
): Promise<string> {
  const reloaded = page.waitForEvent("load");
  const result = await page
    .evaluate(
      ({ name: fileName, bytes: content, type: fileType }) => {
        const store = window.weekBudgetPlanner?.store;
        if (store === undefined) throw new Error("The app hasn't opened its storage.");
        return store.importFile(new File([new Uint8Array(content)], fileName, { type: fileType }));
      },
      { name, bytes: [...bytes], type },
    )
    // A database import reloads every tab, which ends this page's script before it can answer.
    .catch(() => "imported");
  if (result === "imported") await reloaded;
  return result;
}

export const toBytes = (text: string): number[] => [...new TextEncoder().encode(text)];

/** Exports the database, as Settings will: its file name and its bytes. */
export function exportDatabase(page: Page): Promise<{ name: string; bytes: number[] }> {
  return page.evaluate(async () => {
    const store = window.weekBudgetPlanner?.store;
    if (store === undefined) throw new Error("The app hasn't opened its storage.");
    const file = await store.exportFile();
    if (file === "newer-version") throw new Error("A newer version saved the plan.");
    return { name: file.filename, bytes: [...new Uint8Array(await file.blob.arrayBuffer())] };
  });
}

/** Loads the plan, and says whether it came back or the call gave up. */
export function tryLoading(page: Page): Promise<"answered" | "gave up"> {
  return page.evaluate(async () => {
    const store = window.weekBudgetPlanner?.store;
    if (store === undefined) throw new Error("The app hasn't opened its storage.");
    try {
      // Whether the plan came back or a newer version has it, the call was answered.
      void (await store.load());
    } catch {
      return "gave up";
    }
    return "answered";
  });
}

/** Deletes all data and waits for the reload that follows. */
export async function deleteAllData(page: Page): Promise<void> {
  const reloaded = page.waitForEvent("load");
  // Deleting reloads every tab, which ends this page's script before it can answer.
  await page.evaluate(() => window.weekBudgetPlanner?.store.wipe()).catch(() => {});
  await reloaded;
}

/**
 * The description Chromium gives the button with this name, which is what screen readers hear.
 * Playwright's toHaveAccessibleDescription computes its own, which found none when the reload
 * prompt's description came from an <output>, so this asks Chromium's accessibility tree.
 */
export async function readDescription(page: Page, buttonName: string): Promise<string | undefined> {
  const session = await page.context().newCDPSession(page);
  const { nodes } = await session.send("Accessibility.getFullAXTree");
  const button = nodes.find(
    (node) => node.role?.value === "button" && node.name?.value === buttonName,
  );
  const description: unknown = button?.description?.value;
  return typeof description === "string" ? description : undefined;
}
