import { expect, test, type ConsoleMessage, type Page, type Route } from "@playwright/test";

import { expectStatus } from "./app.ts";
import { startRelayProxy } from "./relay-proxy.ts";

// The transport (crates/transport) against the Rust server's relay and node, from its worker, under
// the server's headers: the policy, Trusted Types and cross-origin isolation. Runs with
// `pnpm test:server`, which builds the module first. The transport check page drives it, since
// nothing in the app turns syncing on yet (see crates/transport/README.md).

const ORIGIN = "http://127.0.0.1:4313";
const BASE = "/week-budget-planner/";
const CHECK_URL = `${ORIGIN}${BASE}transport-check.html`;
/** The paths only the transport asks for: the server's node, and the relay. */
const TRANSPORT_PATHS = new Set(["/node", "/ping", "/relay"]);

const SERVER_PORT = 4313;

/** Whether a request is the transport's: the module, its worker's code, the relay or the node. */
const isTransportPath = (path: string): boolean =>
  TRANSPORT_PATHS.has(path) || path.includes("transport");

/** A proxy in front of the server, closed when the test's scope ends. */
async function openProxy() {
  const proxy = await startRelayProxy(SERVER_PORT);
  return Object.assign(proxy, { [Symbol.asyncDispose]: () => proxy.close() });
}

/** Collects what the page logs as an error, policy violations included. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function readOutcome(page: Page, timeout: number): Promise<string | undefined> {
  await page.waitForFunction(
    () => document.documentElement.dataset["outcome"] !== undefined,
    null,
    {
      timeout,
    },
  );
  return page.evaluate(() => document.documentElement.dataset["outcome"]);
}

test("echoes bytes through the relay to the server's node, from a worker", async ({ page }) => {
  const errors = collectErrors(page);
  const response = await page.goto(CHECK_URL);
  expect(response?.headers()["content-security-policy"]).toContain(
    "require-trusted-types-for 'script'",
  );
  expect(await readOutcome(page, 20_000)).toBe("echoed");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(errors).toEqual([]);
});

test("a relay that never answers ends in the timeout, not a hang", async ({ page }) => {
  // The connection opens, and nothing ever comes back: how iroh sees a relay that a network blocks.
  await using proxy = await openProxy();
  proxy.setMode("silent");
  await page.goto(`${proxy.origin}${BASE}transport-check.html?timeout=2000`);
  expect(await readOutcome(page, 10_000)).toBe("timeout");
  expect(proxy.countRelayConnections()).toBeGreaterThan(0);
});

test("a missing relay ends in the timeout, not a hang", async ({ page }) => {
  await using proxy = await openProxy();
  proxy.setMode("refuse");
  await page.goto(`${proxy.origin}${BASE}transport-check.html?timeout=2000`);
  expect(await readOutcome(page, 10_000)).toBe("timeout");
});

test("reaches the server's node again after the relay drops and comes back", async ({ page }) => {
  await using proxy = await openProxy();
  await page.goto(`${proxy.origin}${BASE}transport-check.html?timeout=30000`);
  expect(await readOutcome(page, 40_000)).toBe("echoed");
  const before = proxy.countRelayConnections();

  // The relay goes away and comes back: its connections drop, and the next one is refused once.
  proxy.setMode("refuse");
  proxy.dropRelay();
  await page.waitForTimeout(500);
  proxy.setMode("pass");
  // The node connects again on its own, after a backoff.
  await page.getByRole("button", { name: "Send again" }).click();
  expect(await readOutcome(page, 40_000)).toBe("echoed");
  expect(proxy.countRelayConnections()).toBeGreaterThan(before);
});

// The page fetches /node itself, so Playwright can answer it, unlike the worker's relay.
const SERVER_ANSWERS = [
  {
    outcome: "no-server",
    when: "nothing answers",
    answer: (route: Route) => route.abort("connectionrefused"),
  },
  {
    outcome: "no-node",
    when: "the server has no /node",
    answer: (route: Route) => route.fulfill({ status: 404 }),
  },
  {
    outcome: "unreadable-node",
    when: "/node describes no node",
    answer: (route: Route) => route.fulfill({ json: { id: "not the field it reads" } }),
  },
];

for (const { outcome, when, answer } of SERVER_ANSWERS) {
  test(`ends in ${outcome} when ${when}`, async ({ page }) => {
    await page.route("**/node", answer);
    await page.goto(CHECK_URL);
    expect(await readOutcome(page, 10_000)).toBe(outcome);
  });
}

test("the app's normal start asks for nothing of the transport's", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    asked.push(new URL(request.url()).pathname);
  });
  await page.goto(`${ORIGIN}${BASE}`);
  await expectStatus(page, "full");
  expect(asked.filter((path) => isTransportPath(path))).toEqual([]);
});
