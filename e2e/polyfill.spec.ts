import { expect, test } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// The app in a browser without the features Safari still lacks, so the polyfills have to load (see
// docs/spec/browser-support.md). Every module the entry imports runs before the polyfills have
// loaded, so one that uses Temporal at its top level breaks the whole app there.
test("opens and shows every page without Temporal or the disposable stacks", async ({ page }) => {
  await page.addInitScript(() => {
    // Reflect.deleteProperty, since `delete` on a global the types declare doesn't compile.
    Reflect.deleteProperty(globalThis, "Temporal");
    Reflect.deleteProperty(globalThis, "DisposableStack");
    Reflect.deleteProperty(globalThis, "AsyncDisposableStack");
  });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  await page.goto(`${ISOLATED_URL}activities`);
  await expectStatus(page, "full");
  await page.goto(`${ISOLATED_URL}settings`);
  await expectStatus(page, "full");
  await expect(page.getByText(/^Built /u)).toBeVisible();
  expect(errors).toEqual([]);
});
