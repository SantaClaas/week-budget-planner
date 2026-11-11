import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { ISOLATED_URL, PAGES_URL, expectStatus, removeFirstBlock } from "./app.ts";

// Settings › Your data and Storage (see Export, import and reset, and Keeping the data, in
// docs/spec/persistence.md): the paths that keep, replace or delete the user's plan.
test.use({ locale: "en-GB" });

async function openSettings(page: Page, url = ISOLATED_URL, level: "full" | "limited" = "full") {
  await page.goto(`${url}settings`);
  await expectStatus(page, level);
}

/** Exports the plan with the button, and gives back the file's name and bytes. */
async function exportWithButton(
  page: Page,
  name: RegExp,
): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name }).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path) };
}

/** Picks a file to import with the button, which asks before anything changes. */
async function pickFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /^Import (database|plan)$/u }).click(),
  ]);
  await chooser.setFiles(file);
}

test("exports the database and imports it again, after asking", async ({ page }) => {
  await openSettings(page);
  const exported = await exportWithButton(page, /^Export database$/u);
  expect(exported.name).toMatch(/^week-budget-planner-\d{4}-\d{2}-\d{2}\.db$/u);
  expect(exported.bytes.subarray(0, 15).toString()).toBe("SQLite format 3");

  await removeFirstBlock(page);
  await page.reload();
  await expectStatus(page, "full", "5 activities · 7 blocks");

  // Cancel changes nothing.
  const file = { name: "backup.db", mimeType: "application/vnd.sqlite3", buffer: exported.bytes };
  await pickFile(page, file);
  const dialog = page.getByRole("alertdialog", { name: "Replace your plan?" });
  await expect(dialog).toHaveAccessibleDescription(
    /“backup\.db” replaces the plan in this browser: 5 activities and 7 blocks\./u,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expectStatus(page, "full", "5 activities · 7 blocks");

  await pickFile(page, file);
  await dialog.getByRole("button", { name: "Replace" }).click();
  // Every tab reloads with the imported plan.
  await expectStatus(page, "full");
});

test("refuses a file that isn't a database, and keeps the plan", async ({ page }) => {
  await openSettings(page);
  await pickFile(page, {
    name: "notes.db",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("notes"),
  });
  await page.getByRole("button", { name: "Replace" }).click();
  await expect(page.locator(".snackbar")).toContainText(
    "This file isn't a Week Budget Planner database, so nothing was changed.",
  );
  await page.reload();
  await expectStatus(page, "full");
});

test("deletes all data after asking, and starts over", async ({ page }) => {
  await openSettings(page);
  await removeFirstBlock(page);
  await page.reload();
  await expectStatus(page, "full", "5 activities · 7 blocks");
  await page.getByRole("button", { name: "Delete all data" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete all data?" });
  await expect(dialog).toHaveAccessibleDescription(/5 activities and 7 blocks/u);
  await dialog.getByRole("button", { name: "Delete all data" }).click();
  // The database is gone, so the app starts as on a first visit, with the example week.
  await expectStatus(page, "full");
});

test("says how safely the plan is kept, and how big it is", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByText("Keeping your plan")).toBeVisible();
  const storage = page.getByRole("region", { name: "Storage" });
  await expect(storage.getByRole("definition").nth(0)).toHaveText("5");
  await expect(storage.getByRole("definition").nth(1)).toHaveText("8");
  await expect(storage.getByRole("definition").nth(2)).toHaveText(/^\d+ kB$/u);
});

test.describe("in limited storage", () => {
  test.use({ serviceWorkers: "block" });

  test("explains it, and exports and imports the plan as a .json file", async ({ page }) => {
    await openSettings(page, PAGES_URL, "limited");
    await expect(
      page.getByRole("region", { name: "Your plan is in limited storage" }),
    ).toBeVisible();
    // No database, so no size.
    await expect(page.getByRole("region", { name: "Storage" }).getByRole("term")).toHaveCount(2);

    const exported = await exportWithButton(page, /^Export plan$/u);
    expect(exported.name).toMatch(/^week-budget-planner-\d{4}-\d{2}-\d{2}\.json$/u);

    await removeFirstBlock(page);
    await page.reload();
    await expectStatus(page, "limited", "5 activities · 7 blocks");
    await pickFile(page, {
      name: exported.name,
      mimeType: "application/json",
      buffer: exported.bytes,
    });
    await page.getByRole("button", { name: "Replace" }).click();
    await expectStatus(page, "limited");
  });
});
