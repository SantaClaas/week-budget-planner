import { expect, test } from "@playwright/test";

import { ISOLATED_URL, PAGES_URL, expectStatus } from "./app.ts";

// Moving between the pages (see Pages and URLs in docs/spec/layout.md, and Pages and navigation in
// docs/spec/accessibility.md). A reload of a page's path has to start the app there, or a bookmark
// would land on GitHub Pages' own error page.

const heading = (name: string) => ({ level: 1, name });

test("starts on the page a reloaded path names, through GitHub Pages' 404 page", async ({
  page,
}) => {
  await page.goto(`${PAGES_URL}activities`);
  // The service worker reloads the page once to isolate it; the path has to survive that too.
  await expect.poll(() => page.evaluate(() => crossOriginIsolated).catch(() => false)).toBe(true);
  await expect(page.getByRole("heading", heading("Activities"))).toBeVisible();
  await expect(page).toHaveTitle("Activities · Week Budget Planner");
  await page.reload();
  await expect(page.getByRole("heading", heading("Activities"))).toBeVisible();
  await expect(page).toHaveURL(`${PAGES_URL}activities`);
});

test("moves between pages without a reload, and back with the browser", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  // Gone after a reload, so it shows whether one happened.
  await page.evaluate(() => Object.assign(window, { isSamePage: true }));
  const navigation = page.getByRole("navigation", { name: "Sections" });

  await navigation.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(`${ISOLATED_URL}settings`);
  await expect(page.getByRole("heading", heading("Settings"))).toBeFocused();
  await expect(navigation.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.goBack();
  await expect(page).toHaveURL(ISOLATED_URL);
  await expect(page.getByRole("heading", heading("Week"))).toBeVisible();
  await expect(page).toHaveTitle("Week · Week Budget Planner");
  expect(await page.evaluate(() => "isSamePage" in window)).toBe(true);
});

test("says when a path has no page, and keeps the address", async ({ page }) => {
  await page.goto(`${ISOLATED_URL}no-such-page`);
  await expect(page.getByRole("heading", heading("Page not found"))).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Week Budget Planner");
  await expect(page).toHaveURL(`${ISOLATED_URL}no-such-page`);
  // No destination is current, and the page leads back to the week.
  await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Go to the week" }).click();
  await expect(page.getByRole("heading", heading("Week"))).toBeFocused();
});

test("shows a page for another spelling of its path, and fixes the address", async ({ page }) => {
  await page.goto(`${ISOLATED_URL}settings/`);
  await expect(page.getByRole("heading", heading("Settings"))).toBeVisible();
  await expect(page).toHaveURL(`${ISOLATED_URL}settings`);
});

test("reaches every page with the keyboard, and lands on its heading", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const navigation = page.getByRole("navigation", { name: "Sections" });
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("button", { name: "Expand navigation" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(navigation.getByRole("button", { name: "Collapse navigation" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("button", { name: "New activity" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Activities" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", heading("Activities"))).toBeFocused();
});

test("uses the navigation bar on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  // Only one navigation shows: the bar, without the rail's menu button.
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeHidden();
  await page.getByRole("link", { name: "Activities" }).click();
  await expect(page.getByRole("heading", heading("Activities"))).toBeFocused();
});
