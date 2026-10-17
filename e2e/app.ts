// Helpers for the browser tests. Until the UI exists (phase 4), the placeholder app shows its
// storage level and plan size in a status line, and exposes its plan store as
// window.weekBudgetPlanner. The tests use both; with the UI they'll drive the real controls.
import { expect, type Locator, type Page } from "@playwright/test";

import type { PlanStore } from "../src/storage/plan-store.ts";

declare global {
  interface Window {
    weekBudgetPlanner?: { store: PlanStore };
  }
}

/** The app with the cross-origin isolation headers, as `vite preview` and hosts with headers serve it. */
export const ISOLATED_URL = "http://localhost:4311/week-budget-planner/";
/** The app without them, as GitHub Pages serves it: the service worker has to add them. */
export const PAGES_URL = "http://localhost:4312/week-budget-planner/";

/** The example week: 5 activities and 8 blocks. */
export const EXAMPLE_WEEK = "5 activities · 8 blocks";

export const status = (page: Page): Locator => page.getByTestId("status");

export async function expectStatus(
  page: Page,
  level: "full" | "limited" | "none",
  plan = EXAMPLE_WEEK,
): Promise<void> {
  await expect(status(page)).toHaveText(`Storage: ${level} · ${plan}`);
}

/** Removes the plan's first block, as a user's change would. */
export async function removeFirstBlock(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = window.weekBudgetPlanner?.store;
    if (store === undefined) throw new Error("The app hasn't opened its storage.");
    const { plan } = await store.load();
    await store.save(plan, { ...plan, blocks: plan.blocks.slice(1) });
  });
}

/**
 * Imports a file through the store. Resolves to the error's message when the import is refused, or
 * to "imported" once the page has reloaded with the imported plan.
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
      async ({ name: fileName, bytes: content, type: fileType }) => {
        const store = window.weekBudgetPlanner?.store;
        if (store === undefined) throw new Error("The app hasn't opened its storage.");
        try {
          await store.importFile(new File([new Uint8Array(content)], fileName, { type: fileType }));
          return "imported";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
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
    return { name: file.filename, bytes: [...new Uint8Array(await file.blob.arrayBuffer())] };
  });
}

/** Loads the plan, and says whether it came back or the call gave up. */
export function tryLoading(page: Page): Promise<"answered" | "gave up"> {
  return page.evaluate(async () => {
    const store = window.weekBudgetPlanner?.store;
    if (store === undefined) throw new Error("The app hasn't opened its storage.");
    try {
      await store.load();
      return "answered";
    } catch {
      return "gave up";
    }
  });
}

/** Deletes all data and waits for the reload that follows. */
export async function deleteAllData(page: Page): Promise<void> {
  const reloaded = page.waitForEvent("load");
  // Deleting reloads every tab, which ends this page's script before it can answer.
  await page.evaluate(() => window.weekBudgetPlanner?.store.wipe()).catch(() => {});
  await reloaded;
}
