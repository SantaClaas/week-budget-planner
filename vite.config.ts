import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

// @tursodatabase/database-wasm needs SharedArrayBuffer, so the page must be cross-origin isolated
// in dev and preview too. In production (GitHub Pages, which can't set headers) the service worker
// adds these headers; public/_headers covers hosts that read it.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // GitHub Pages serves the project site from /week-budget-planner/.
  base: "/week-budget-planner/",
  plugins: [solid()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
