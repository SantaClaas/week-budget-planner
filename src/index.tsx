// First, so the Trusted Types policy exists before anything writes HTML (see
// docs/spec/security.md).
// oxlint-disable-next-line import/no-unassigned-import -- importing it creates the policy.
import "./trusted-html.ts";

// oxlint-disable-next-line import/no-unassigned-import -- importing the stylesheets applies them.
import "../docs/design/m3-tokens.css";
// oxlint-disable-next-line import/no-unassigned-import -- the shapes are custom properties for the theme layer.
import "../docs/design/m3-shapes.css";
// oxlint-disable-next-line import/no-unassigned-import -- the page layout, after the components it places.
import "./layout.css";

import { render } from "@solidjs/web";

import { App } from "./App.tsx";
import iconset from "./icons/iconset.svg?raw";
import { loadOpticalSizes } from "./font/index.ts";
import { loadPolyfills } from "./polyfill/index.ts";

await loadPolyfills();
// The icons' symbols, once, before anything shows an icon (see Icons in docs/spec/design.md). The
// build puts this exact file on the Trusted Types allowlist.
document.body.insertAdjacentHTML("afterbegin", iconset);
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
