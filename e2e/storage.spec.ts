import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { connect } from "@tursodatabase/database";
import { expect, test, type Page } from "@playwright/test";

import {
  ISOLATED_URL,
  deleteAllData,
  expectStatus,
  exportDatabase,
  importFile,
  removeFirstBlock,
  toBytes,
  tryLoading,
} from "./app";

// The paths where a failure costs the user their plan: storing it, sharing it between tabs,
// exporting and importing it, and what happens to a database that can't be opened.

test("keeps the plan across a reload and shares changes between tabs", async ({
  page,
  context,
}) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  await page.reload();
  await expectStatus(page, "full");

  const other = await context.newPage();
  await other.goto(ISOLATED_URL);
  await expectStatus(other, "full");
  await removeFirstBlock(other);
  await expectStatus(page, "full", "5 activities · 7 blocks");
});

test("exports the database and imports it again", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const exported = await exportDatabase(page);
  expect(exported.name).toMatch(/^week-budget-planner-\d{4}-\d{2}-\d{2}\.db$/u);
  expect(new TextDecoder().decode(new Uint8Array(exported.bytes.slice(0, 15)))).toBe(
    "SQLite format 3",
  );

  await removeFirstBlock(page);
  await page.reload();
  await expectStatus(page, "full", "5 activities · 7 blocks");
  expect(await importFile(page, "backup.db", exported.bytes)).toBe("imported");
  await expectStatus(page, "full");
});

test("refuses files it can't import and keeps the plan", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  expect(await importFile(page, "notes.db", toBytes("not a database"))).toBe(
    "This file isn't a Week Budget Planner database, so nothing was changed.",
  );
  // Has the SQLite header, but nothing a database can open after it.
  expect(await importFile(page, "fake.db", toBytes(`SQLite format 3\0${"x".repeat(5000)}`))).toBe(
    "This file isn't a Week Budget Planner database, so nothing was changed.",
  );
  expect(
    await importFile(page, "notes.json", toBytes('{"name": "notes"}'), "application/json"),
  ).toBe("This file isn't a Week Budget Planner plan, so nothing was changed.");
  await page.reload();
  await expectStatus(page, "full");
});

test.describe("a newer version of the app", () => {
  let newerDatabase: number[] = [];

  // oxlint-disable-next-line no-empty-pattern -- Playwright reads this pattern to know which fixtures to set up, and this hook needs none.
  test.beforeAll(async ({}, testInfo) => {
    // A database whose migration table lists a migration this version doesn't have.
    await mkdir(testInfo.outputDir, { recursive: true });
    const path = join(testInfo.outputDir, "newer.db");
    const database = await connect(path);
    await database.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)",
    );
    await database.exec(
      "INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('', 0, '29991231000000_future')",
    );
    await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await database.close();
    newerDatabase = [...(await readFile(path))];
  });

  test("refuses its files and keeps the plan", async ({ page }) => {
    await page.goto(ISOLATED_URL);
    await expectStatus(page, "full");
    const message =
      "This file is from a newer version of Week Budget Planner. Reload to update the app, then import it again.";
    expect(await importFile(page, "newer.db", newerDatabase)).toBe(message);
    expect(
      await importFile(page, "newer.json", toBytes('{"version": 2}'), "application/json"),
    ).toBe(message);
    await page.reload();
    await expectStatus(page, "full");
  });

  test("leaves a plan it saved alone, in every tab", async ({ page, context }) => {
    await writeDatabaseFile(page, newerDatabase);
    await page.goto(ISOLATED_URL);
    await expect(page.getByTestId("newer-version")).toContainText("saved by a newer version");
    const other = await context.newPage();
    await other.goto(ISOLATED_URL);
    await expect(other.getByTestId("newer-version")).toContainText("saved by a newer version");
    expect(await readDatabaseFileSize(page)).toBe(newerDatabase.length);
  });
});

test("reports a database that won't open, and deleting it starts over", async ({ page }) => {
  await writeDatabaseFile(page, toBytes("garbage that is not a database"));
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "limited");
  expect(await page.evaluate(() => window.weekBudgetPlanner?.store.fallbackReason)).toBe(
    "database-broken",
  );

  await deleteAllData(page);
  await page.reload();
  await expectStatus(page, "full");
  expect(await page.evaluate(() => window.weekBudgetPlanner?.store.fallbackReason)).toBeUndefined();
});

test("gives up on a leader tab that stops answering", async ({ page, context }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const other = await context.newPage();
  await other.goto(ISOLATED_URL);
  await expectStatus(other, "full");
  // The first tab leads. Muting its channel stands in for a frozen background tab.
  await page.evaluate(() => {
    BroadcastChannel.prototype.postMessage = (): void => {};
  });
  const started = Date.now();
  const outcome = await tryLoading(other);
  expect(outcome).toBe("gave up");
  expect(Date.now() - started).toBeLessThan(15_000);
});

/** Writes the database file before the app opens it, from a same-origin page that doesn't run the app. */
async function writeDatabaseFile(page: Page, bytes: readonly number[]): Promise<void> {
  await page.goto(`${ISOLATED_URL}service-worker.js`);
  await page.evaluate(
    async (content) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle("week-budget-planner.db", { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array(content));
      await writable.close();
    },
    [...bytes],
  );
}

function readDatabaseFileSize(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle("week-budget-planner.db")).getFile();
    return file.size;
  });
}
