import { zstdDecompressSync } from "node:zlib";

import { expect, test } from "@playwright/test";

import { DESTINATIONS, createPath } from "../src/page/index.ts";
import { expectStatus } from "./app.ts";

// The app served by the Rust server (crates/server), which sends the headers the service worker
// adds on GitHub Pages (see Hosting in docs/spec/network.md). Runs with `pnpm test:server`.

const BASE = "/week-budget-planner/";
const SERVER_URL = `http://127.0.0.1:4313${BASE}`;

/** A body as Playwright's request client gave it. */
const keep = (body: Buffer): Buffer => body;

test("reaches the full storage level without a service worker", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const response = await page.goto(SERVER_URL);
  // The header is the page's own <meta> policy with frame-ancestors, which only a header carries.
  const metaPolicy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(response?.headers()["content-security-policy"]).toBe(
    `${String(metaPolicy)}; frame-ancestors 'none'`,
  );
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

test("sends the copy `pnpm compress` made in the encoding the browser takes", async ({
  playwright,
}) => {
  // Playwright's request client decodes br and gzip on its own, but not zstd, which is decoded here.
  const decode = { br: keep, zstd: zstdDecompressSync, gzip: keep };
  for (const [encoding, decompress] of Object.entries(decode)) {
    const request = await playwright.request.newContext({
      extraHTTPHeaders: { "Accept-Encoding": encoding },
    });
    const response = await request.fetch(SERVER_URL, { maxRedirects: 0 });
    expect(response.headers()["content-encoding"], encoding).toBe(encoding);
    expect(decompress(await response.body()).toString(), encoding).toContain("<!doctype html>");
    await request.dispose();
  }
});
