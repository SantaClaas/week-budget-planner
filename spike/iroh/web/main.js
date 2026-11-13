// Runs the spike in the page or in a module worker, as the query says:
//   ?mode=page|worker|accept&relay=<relay URL>&server=<endpoint id>&csp=<variant>
// The result lands in window.spikeResult for the Playwright driver.

import { bind, run } from "./test.js";

const violations = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
});

// Mirrors the app's `default` Trusted Types policy for script URLs: only
// same-origin URLs pass (src/trusted-html.ts).
trustedTypes.createPolicy("default", {
  createScriptURL(url) {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin) throw new TypeError(`refused ${url}`);
    return parsed.href;
  },
});

const parameters = new URLSearchParams(location.search);
const mode = parameters.get("mode") ?? "page";
const relayUrl = parameters.get("relay");
const serverId = parameters.get("server");

function report(result) {
  window.spikeResult = { mode, crossOriginIsolated, violations, ...result };
  document.body.textContent = JSON.stringify(window.spikeResult, null, 2);
}

async function runInPage() {
  try {
    const { node, ...result } = await run({ relayUrl, serverId });
    report({ ok: true, ...result });
    await node.close();
  } catch (error) {
    report({ ok: false, error: String(error) });
  }
}

function runInWorker() {
  const worker = new Worker(`./worker.js${location.search}`, { type: "module" });
  worker.addEventListener("message", (event) => report({ worker: event.data, ok: event.data.ok }));
  worker.addEventListener("error", (event) => report({ ok: false, error: `worker error: ${event.message}` }));
  worker.postMessage({ relayUrl, serverId });
}

// Browser to browser: this page only binds and waits; another page dials it.
async function accept() {
  try {
    const { node, times } = await bind(relayUrl);
    window.spikeNode = node;
    report({ ok: true, endpointId: node.endpointId(), times });
  } catch (error) {
    report({ ok: false, error: String(error) });
  }
}

if (mode === "worker") runInWorker();
else if (mode === "accept") void accept();
else void runInPage();
