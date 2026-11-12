import { expect, test } from "@playwright/test";

import { ISOLATED_URL, PAGES_URL, expectStatus } from "./app.ts";

// Keeping the plan (see Keeping the data and Progressive enhancement in docs/spec/persistence.md):
// the app asks before the browser does, once there's a plan of the user's own, and says so when
// nothing can be saved at all.
test.use({ locale: "en-GB" });

/** The card that asks to keep the plan, named by its bold first words. */
const KEEP_PLAN = { name: "Your browser may delete your plan" };

test("asks to keep the plan once it's the user's own, and Not now puts it away for good", async ({
  page,
}) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  // Not while the example week is shown.
  await expect(page.getByRole("region", KEEP_PLAN)).toBeHidden();

  await page.getByRole("button", { name: "Keep these" }).click();
  const card = page.getByRole("region", KEEP_PLAN);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Not now" }).click();
  await expect(card).toBeHidden();
  // Focus moved on before the card went, to the list's heading.
  await expect(page.getByRole("heading", { name: "Activities" })).toBeFocused();

  await page.reload();
  await expectStatus(page, "full");
  await expect(page.getByRole("region", KEEP_PLAN)).toBeHidden();
});

test("asks the browser only from Keep it, and says what it answered", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  await page.getByRole("button", { name: "Keep these" }).click();
  await page.getByRole("region", KEEP_PLAN).getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("region", KEEP_PLAN)).toBeHidden();
  await expect(page.locator(".snackbar")).toContainText(
    /^This browser (will keep your plan\.|didn't agree to keep your plan\. Export now and then to keep a copy\.)/u,
  );
});

test("says when nothing can be saved, until put away, and exports the plan", async ({
  browser,
}) => {
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
  const card = page.getByRole("region", { name: "This browser doesn't allow saving here." });
  await expect(card).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^week-budget-planner-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/u,
  );

  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(card).toBeHidden();
  // It stays away in this tab, also on another page.
  await page.getByRole("link", { name: "Activities" }).click();
  await expect(
    page.getByRole("region", { name: "This browser doesn't allow saving here." }),
  ).toBeHidden();
  await context.close();
});
