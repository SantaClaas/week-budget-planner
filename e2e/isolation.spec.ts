import { expect, test } from "@playwright/test";

import { PAGES_URL, expectStatus, readDescription } from "./app.ts";

// The storage levels (see Progressive enhancement in docs/spec/persistence.md). GitHub Pages can't
// send the isolation headers, so the full level depends on the service worker adding them. Where
// that's impossible, the app has to fall back without losing what it can keep.

test("gets the full level on GitHub Pages through the service worker", async ({ page }) => {
  await page.goto(PAGES_URL);
  // The first visit registers the worker and reloads once it controls the page.
  // The page reloads during the wait, which ends a check in flight: that counts as not yet.
  await expect.poll(() => page.evaluate(() => crossOriginIsolated).catch(() => false)).toBe(true);
  await expectStatus(page, "full");
});

test("keeps the plan in limited storage when service workers are blocked", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(PAGES_URL);
  await expectStatus(page, "limited");
  await page.reload();
  await expectStatus(page, "limited");
  await context.close();
});

test("leaves a plan in limited storage alone when a newer version saved it", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const newer = JSON.stringify({ version: 2, activities: [{ id: "a", name: "From the future" }] });
  await page.goto(PAGES_URL);
  await expectStatus(page, "limited");
  await page.evaluate((text) => {
    localStorage.setItem("week-budget-planner.plan", text);
  }, newer);
  await page.reload();
  await expect(page.getByTestId("newer-version")).toContainText("saved by a newer version");
  await expect(
    page.getByRole("heading", { name: "Your plan was saved by a newer version" }),
  ).toBeVisible();
  expect(await readDescription(page, "Reload")).toBe(
    "Your plan was saved by a newer version Reload to update Week Budget Planner. Your plan is safe, and nothing was changed.",
  );
  expect(await page.evaluate(() => localStorage.getItem("week-budget-planner.plan"))).toBe(newer);
  await context.close();
});

test("still runs without any storage", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage is blocked.", "SecurityError");
      },
    });
  });
  const page = await context.newPage();
  await page.goto(PAGES_URL);
  await expectStatus(page, "none");
  await context.close();
});
