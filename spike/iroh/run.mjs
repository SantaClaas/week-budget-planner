// Drives the spike end to end: starts the native server (our relay plus a
// native iroh node), the static server, and headless Chromium, then runs
// each scenario and prints its result as JSON.
//
//   node run.mjs   (after ./build.sh)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

// Playwright is preinstalled outside the repository; NODE_PATH points to it.
const { chromium } = createRequire(`${process.cwd()}/`)("playwright");

const here = new URL(".", import.meta.url).pathname;
const pagePort = 8080;
const relayPort = 3340;

function startServer() {
  const child = spawn(`${here}target/release/spike-server`, [], {
    env: { ...process.env, RELAY_PORT: String(relayPort) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve) => {
    createInterface({ input: child.stdout }).once("line", (line) => resolve({ child, ...JSON.parse(line) }));
  });
}

function startStatic() {
  const child = spawn(process.execPath, [`${here}web/serve.mjs`, String(pagePort), String(relayPort)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve) => {
    createInterface({ input: child.stdout }).once("line", () => resolve(child));
  });
}

async function open(browser, query) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const console = [];
  page.on("console", (message) => console.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => console.push(`pageerror: ${error.message}`));
  page.on("websocket", (socket) => {
    console.push(`websocket opened: ${socket.url()}`);
    socket.on("socketerror", (error) => console.push(`websocket error: ${socket.url()} ${error}`));
    socket.on("close", () => console.push(`websocket closed: ${socket.url()}`));
  });
  page.on("requestfailed", (request) =>
    console.push(`request failed: ${request.url()} ${request.failure()?.errorText}`),
  );
  await page.goto(`http://localhost:${pagePort}/?${new URLSearchParams(query)}`);
  return { context, page, console };
}

async function waitForResult(page, timeout = 30_000) {
  try {
    await page.waitForFunction(() => window.spikeResult !== undefined, null, { timeout });
    return await page.evaluate(() => window.spikeResult);
  } catch {
    return { ok: false, error: `no result within ${timeout} ms` };
  }
}

async function scenario(browser, name, query) {
  const { context, page, console } = await open(browser, query);
  const result = await waitForResult(page);
  await context.close();
  return { name, result, console: console.filter((line) => !line.startsWith("debug")).slice(0, 30) };
}

const server = await startServer();
const staticServer = await startStatic();
const isPublic = process.env.PUBLIC === "1";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium",
  // In a cloud container, outside hosts are reachable only through its proxy.
  ...(isPublic && process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {}),
});
const crossOriginRelay = `http://localhost:${relayPort}`;
const sameOriginRelay = `http://localhost:${pagePort}`;
const results = [];

// PUBLIC=1: the native node and the page both use n0's public relays.
async function runPublicScenarios() {
  results.push(await scenario(browser, "public: page, the app's policy unchanged", {
    mode: "page", csp: "app", relay: "public", server: server.endpointId,
  }));
  results.push(await scenario(browser, "public: page, connect-src for n0's relays and DNS", {
    mode: "page", csp: "public", relay: "public", server: server.endpointId,
  }));
  // Passes CSP, but this container's proxy resets connections to host names
  // with a trailing dot, so it can't finish here.
  results.push(await scenario(browser, "public: page, connect-src with the relays' trailing dot", {
    mode: "page", csp: "public-dot", relay: "public", server: server.endpointId,
  }));
  // The same n0 relays, written without the trailing dot.
  results.push(await scenario(browser, "public: page, relays without the trailing dot", {
    mode: "page", csp: "public", relay: "public-without-dot", server: server.endpointId,
  }));
  results.push(await scenario(browser, "public: worker, relays without the trailing dot", {
    mode: "worker", csp: "public", relay: "public-without-dot", server: server.endpointId,
  }));
}

async function runLocalScenarios() {
  results.push(await scenario(browser, "page, relay on another origin, connect-src allows it", {
    mode: "page", csp: "relay", relay: crossOriginRelay, server: server.endpointId,
  }));
  results.push(await scenario(browser, "worker, relay on another origin, connect-src allows it", {
    mode: "worker", csp: "relay", relay: crossOriginRelay, server: server.endpointId,
  }));
  results.push(await scenario(browser, "page, relay on another origin, connect-src for its WebSocket only", {
    mode: "page", csp: "relay-websocket-only", relay: crossOriginRelay, server: server.endpointId,
  }));
  results.push(await scenario(browser, "page, relay on another origin, the app's policy unchanged", {
    mode: "page", csp: "app", relay: crossOriginRelay, server: server.endpointId,
  }));
  results.push(await scenario(browser, "page, relay on the page's origin, the app's policy unchanged", {
    mode: "page", csp: "app", relay: sameOriginRelay, server: server.endpointId,
  }));
  results.push(await scenario(browser, "worker, relay on the page's origin, the app's policy unchanged", {
    mode: "worker", csp: "app", relay: sameOriginRelay, server: server.endpointId,
  }));

  // Browser to browser, both relayed through the same relay.
  const accepting = await open(browser, { mode: "accept", csp: "app", relay: sameOriginRelay });
  const accepted = await waitForResult(accepting.page);
  const dialing = accepted.ok
    ? await scenario(browser, "browser to browser (page dials another page's node)", {
        mode: "page", csp: "app", relay: sameOriginRelay, server: accepted.endpointId,
      })
    : { name: "browser to browser", result: { ok: false, error: "accepting page failed", accepted } };
  results.push(dialing);
  await accepting.context.close();
}

try {
  await (isPublic ? runPublicScenarios() : runLocalScenarios());
} finally {
  await browser.close();
  staticServer.kill();
  server.child.kill("SIGINT");
}

console.log(JSON.stringify({ server: { endpointId: server.endpointId, relayUrl: server.relayUrl }, results }, null, 2));
