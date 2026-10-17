import { render } from "@solidjs/web";

import { App } from "./App";
import { loadOpticalSizes } from "./font";
import { loadPolyfills } from "./polyfills";

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing from index.html.");

await loadPolyfills();
render(() => <App />, root);

// The larger font file waits until the page has loaded, so it never delays the first paint.
const swapFont = () =>
  void loadOpticalSizes().catch((error: unknown) => console.warn("[font] optical sizes didn't load", error));
if (document.readyState === "complete") swapFont();
else window.addEventListener("load", swapFont, { once: true });
