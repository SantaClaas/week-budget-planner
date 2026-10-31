import { expect, test, type Page } from "@playwright/test";

import { ISOLATED_URL, PAGES_URL, expectStatus } from "./app.ts";

// The Content Security Policy and Trusted Types (see docs/spec/security.md). They're checked by
// the browser at runtime, so only a browser can test them.

/**
 * Tries what the policy must refuse, after a timer so the code runs as the page's own: code that
 * the test evaluates directly is exempt from the policy. Runs in the page.
 */
async function attemptForbidden(): Promise<Record<string, string>> {
  const attempts: Record<string, () => void> = {
    innerHTML: () => {
      document.createElement("div").innerHTML = "<img src=x onerror=alert(1)>";
    },
    insertAdjacentHTML: () => {
      document.body.insertAdjacentHTML("beforeend", "<b>untrusted</b>");
    },
    eval: () => {
      // oxlint-disable-next-line no-eval -- the point of the test: the policy has to refuse it.
      globalThis.eval("1");
    },
    crossOriginWorker: () => {
      void new Worker("https://example.com/worker.js");
    },
  };
  // The rest runs in the timer's task, no longer in the test's evaluation.
  const timer = Promise.withResolvers<void>();
  setTimeout(() => {
    timer.resolve();
  });
  await timer.promise;
  const outcomes: Record<string, string> = {};
  for (const [name, attempt] of Object.entries(attempts)) {
    try {
      attempt();
    } catch (error) {
      outcomes[name] = error instanceof Error ? error.name : "thrown";
      continue;
    }
    outcomes[name] = "allowed";
  }
  return outcomes;
}

/** Reloads and returns the navigation's response headers. */
async function reloadForHeaders(page: Page): Promise<Record<string, string>> {
  const response = await page.reload();
  if (response === null) throw new Error("The reload had no response.");
  return response.headers();
}

test("refuses untrusted HTML and code from the page's own scripts", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    "content",
    /require-trusted-types-for 'script'/u,
  );
  expect(await page.evaluate(attemptForbidden)).toEqual({
    innerHTML: "TypeError",
    insertAdjacentHTML: "TypeError",
    eval: "EvalError",
    crossOriginWorker: "TypeError",
  });
});

test("adds the headers a meta policy can't set, through the service worker", async ({ page }) => {
  await page.goto(PAGES_URL);
  // The page reloads during the wait, which ends a check in flight: that counts as not yet.
  await expect.poll(() => page.evaluate(() => crossOriginIsolated).catch(() => false)).toBe(true);
  const headers = await reloadForHeaders(page);
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});
