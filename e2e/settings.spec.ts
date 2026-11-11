import { expect, test, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// The Settings page's Appearance and Week sections, and the week tools above the grid (see Settings
// page in docs/spec/layout.md). Day hours and Clear week change the plan, so a reload keeps them.
test.use({ locale: "en-GB" });

async function openSettings(page: Page): Promise<void> {
  await page.goto(`${ISOLATED_URL}settings`);
  await expectStatus(page, "full");
}

test("chooses a theme, contrast and motion from the keyboard, and keeps them", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);
  const theme = page.getByRole("group", { name: "Theme" });
  const system = theme.getByRole("radio", { name: "System" });
  await expect(system).toBeChecked();
  await expect(system).toHaveAccessibleDescription("System is currently light.");

  // The arrow keys move through a radio group and choose as they go.
  await system.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");

  await page.getByRole("group", { name: "Contrast" }).getByRole("radio", { name: "More" }).check();
  await page.getByRole("group", { name: "Motion" }).getByRole("radio", { name: "Reduced" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

  await page.reload();
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
  await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();

  // System follows the browser again.
  await theme.getByRole("radio", { name: "System" }).check();
  await page
    .getByRole("group", { name: "Contrast" })
    .getByRole("radio", { name: "System" })
    .check();
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "light dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-contrast");
});

test("follows a theme chosen in another tab", async ({ page, context }) => {
  await openSettings(page);
  const other = await context.newPage();
  await other.goto(`${ISOLATED_URL}settings`);
  await other.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" }).check();
  await expect(
    page.getByRole("group", { name: "Theme" }).getByRole("radio", { name: "Dark" }),
  ).toBeChecked();
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");
});

test("changes the day hours and clears the week from the tools above it", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const dayHours = page.getByRole("button", { name: "Day hours · 07:00–22:00" });
  await dayHours.click();
  const menu = page.getByRole("region", { name: "Day hours" });
  await menu.getByLabel("Start").selectOption({ label: "09:00" });
  await expect(page.getByRole("button", { name: "Day hours · 09:00–22:00" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.getByRole("button", { name: "Clear week" }).click();
  await expect(page.locator(".snackbar")).toContainText("Removed 8 blocks from the week.");
  await expectStatus(page, "full", "5 activities · 0 blocks");
  await expect(page.getByRole("button", { name: "Clear week" })).toBeDisabled();
  await page.locator(".snackbar").getByRole("button", { name: "Undo" }).click();
  await expectStatus(page, "full", "5 activities · 8 blocks");

  await page.reload();
  await expect(page.getByRole("button", { name: "Day hours · 09:00–22:00" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

  test("has the week tools in Settings, not above the week", async ({ page }) => {
    await page.goto(ISOLATED_URL);
    await expectStatus(page, "full");
    await expect(page.getByRole("button", { name: "Clear week" })).toBeHidden();

    await page.getByRole("link", { name: "Settings" }).tap();
    const dayHours = page.getByRole("button", { name: "Day hours" });
    await expect(dayHours).toHaveAccessibleDescription("07:00–22:00");
    await dayHours.tap();
    await page
      .getByRole("region", { name: "Day hours" })
      .getByLabel("End")
      .selectOption({ label: "20:00" });
    await expect(dayHours).toHaveAccessibleDescription("07:00–20:00");

    await page.getByRole("button", { name: "Clear week" }).tap();
    await expectStatus(page, "full", "5 activities · 0 blocks");
  });
});
