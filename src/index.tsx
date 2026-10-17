// First, so the Trusted Types policy exists before anything writes HTML (see Security in docs/SPEC.md).
import "./trusted-html";

import { render } from "@solidjs/web";

import { App } from "./App.tsx";
import { loadOpticalSizes } from "./font/index.ts";
import { loadPolyfills } from "./polyfills.ts";

await loadPolyfills();
// Straight into the body, with no wrapper element (see Shape in docs/guidelines/solid.md). Solid
// appends after what's already there, the <noscript> message and the icon sprite.
render(() => <App />, document.body);

const swapFont = (): void => {
  loadOpticalSizes().catch((error: unknown) => {
    console.warn("[font] optical sizes didn't load", error);
  });
};

/** The larger font file waits until the page has loaded, so it never delays the first paint. */
function swapFontAfterLoad(): void {
  if (document.readyState === "complete") {
    swapFont();
    return;
  }
  window.addEventListener("load", swapFont, { once: true });
}
swapFontAfterLoad();
