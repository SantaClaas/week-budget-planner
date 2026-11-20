import { expect, test } from "@playwright/test";

import { DESTINATIONS, createPath } from "../src/page/index.ts";
import { expectStatus } from "./app.ts";

// The app served by the Rust server (crates/server), which sends the headers the service worker
// adds on GitHub Pages (see Hosting in docs/spec/network.md). Runs with `pnpm test:server`.

const BASE = "/week-budget-planner/";
const SERVER_URL = `http://127.0.0.1:4313${BASE}`;

test("reaches the full storage level without a service worker", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const response = await page.goto(SERVER_URL);
  expect(response?.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'$/u);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expectStatus(page, "full");
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await context.close();
});

test("serves every page of the app, and a 404 for the rest", async ({ request }) => {
  for (const destination of DESTINATIONS) {
    const response = await request.get(`http://127.0.0.1:4313${createPath(destination, BASE)}`);
    expect(response.status(), destination).toBe(200);
  }

  const missing = await request.get(`${SERVER_URL}nothing-here`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("<!doctype html>");
});
