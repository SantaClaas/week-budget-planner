import { run } from "./test.js";

const violations = [];
self.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
});

self.addEventListener("message", async (event) => {
  try {
    const { node, ...result } = await run(event.data);
    postMessage({ ok: true, ...result, crossOriginIsolated, violations });
    await node.close();
  } catch (error) {
    postMessage({ ok: false, error: String(error), crossOriginIsolated, violations });
  }
});
