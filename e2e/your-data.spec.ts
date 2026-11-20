import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { connect } from "@tursodatabase/database";
import * as driverCore from "drizzle-orm/tursodatabase/driver-core";
import { migrate } from "drizzle-orm/tursodatabase/wasm-migrator";

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
  expect(exported.name).toMatch(/^week-budget-planner-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/u);
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

/** Whether a value is a node row as SQLite gives it back. */
const isNode = (value: unknown): value is { node_id: string; clock: string } =>
  typeof value === "object" &&
  value !== null &&
  "node_id" in value &&
  typeof value.node_id === "string" &&
  "clock" in value &&
  typeof value.clock === "string";

/** The node in an exported database file: the id it stamps with and its clock. */
async function readNode(bytes: Buffer): Promise<{ node_id: string; clock: string }> {
  const path = join(await mkdtemp(join(tmpdir(), "week-budget-planner-")), "exported.db");
  await writeFile(path, bytes);
  const connection = await connect(path);
  const statement = await connection.prepare("SELECT node_id, clock FROM node");
  const node: unknown = await statement.get();
  await connection.close();
  if (!isNode(node)) throw new Error("The exported file has no node.");

  return node;
}

test("gives this browser a new node id after an import, and keeps its later clock", async ({
  page,
}) => {
  await openSettings(page);
  const exported = await exportWithButton(page, /^Export database$/u);
  const before = await readNode(exported.bytes);
  // A change after the export moves this browser's clock past the file's.
  await removeFirstBlock(page);
  await page.goto(`${ISOLATED_URL}settings`);
  const changed = await readNode((await exportWithButton(page, /^Export database$/u)).bytes);

  await pickFile(page, {
    name: "backup.db",
    mimeType: "application/vnd.sqlite3",
    buffer: exported.bytes,
  });
  await page
    .getByRole("alertdialog", { name: "Replace your plan?" })
    .getByRole("button", { name: "Replace" })
    .click();
  await expectStatus(page, "full", "5 activities · 8 blocks");
  const after = await readNode((await exportWithButton(page, /^Export database$/u)).bytes);

  expect(after.node_id).not.toBe(before.node_id);
  expect(after.clock).toBe(changed.clock);
});

/**
 * A database file as the first release saved it, before stamps: only the first migration, with a
 * plan of two activities and three blocks. Made in Node with the same engine the app runs.
 */
async function createDatabaseBeforeStamps(): Promise<Buffer> {
  const drizzleFolder = new URL("../drizzle/", import.meta.url);
  const [first = ""] = (await readdir(drizzleFolder)).toSorted();
  const sql = await readFile(new URL(`${first}/migration.sql`, drizzleFolder), "utf8");
  const path = join(await mkdtemp(join(tmpdir(), "week-budget-planner-")), "before-stamps.db");
  const connection = await connect(path);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- construct() exists at runtime, but Drizzle's types leave it out (as in src/database/migration.ts).
  const driver = driverCore as unknown as {
    construct(client: unknown): Parameters<typeof migrate>[0];
  };
  expect(await migrate(driver.construct(connection), { migrations: { [first]: sql } })).toBeFalsy();
  await connection.exec(`INSERT INTO activities VALUES
    ('work', 'Work', 78, 'square', 'week', 720, 5, 1, '2026-10-01T00:00:00Z'),
    ('gym', 'Gym', 152, 'arch', 'day', 90, 3, 0, '2026-10-01T00:00:00Z')`);
  await connection.exec(`INSERT INTO blocks VALUES
    ('b1', 'work', 0, 600, 90), ('b2', 'gym', 2, 420, 60), ('b3', 'gym', 4, 420, 60)`);
  await connection.exec("INSERT INTO settings VALUES (1, 7, 22, NULL)");
  await connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await connection.close();
  return readFile(path);
}

/** The names of the stored plan's activities, in their order. */
const readActivityNames = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const loaded = await window.weekBudgetPlanner?.store.load();
    if (loaded === undefined || loaded === "newer-version") return [];

    return loaded.plan.activities.map((activity) => activity.name);
  });

test("imports a database saved before stamps, keeps its plan, and saves on it", async ({
  page,
}) => {
  await openSettings(page);
  await pickFile(page, {
    name: "before-stamps.db",
    mimeType: "application/vnd.sqlite3",
    buffer: await createDatabaseBeforeStamps(),
  });
  await page
    .getByRole("alertdialog", { name: "Replace your plan?" })
    .getByRole("button", {
      name: "Replace",
    })
    .click();
  await expectStatus(page, "full", "2 activities · 3 blocks");
  // The order is the old positions', and the names and blocks are as they were.
  expect(await readActivityNames(page)).toEqual(["Gym", "Work"]);

  // A change is saved through the migrated rows, and kept after a reload.
  await removeFirstBlock(page);
  await page.reload();
  await expectStatus(page, "full", "2 activities · 2 blocks");
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
    expect(exported.name).toMatch(
      /^week-budget-planner-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/u,
    );

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
