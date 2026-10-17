// First, so the Trusted Types policy exists before anything writes HTML (see Security in docs/SPEC.md).
// oxlint-disable-next-line import/no-unassigned-import -- importing it creates the policy.
import "./trusted-html.ts";

import { render } from "@solidjs/web";

import { App } from "./App.tsx";
import { loadOpticalSizes } from "./font/index.ts";
import { loadPolyfills } from "./polyfills.ts";

const root = document.querySelector("#root");
if (!root) throw new Error("The #root element is missing from index.html.");

await loadPolyfills();
render(() => <App />, root);

// The larger font file waits until the page has loaded, so it never delays the first paint.
const swapFont = (): void => {
  loadOpticalSizes().catch((error: unknown) => {
    console.warn("[font] optical sizes didn't load", error);
  });
};
if (document.readyState === "complete") swapFont();
else window.addEventListener("load", swapFont, { once: true });
