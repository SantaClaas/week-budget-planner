import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

import packageJson from "./package.json" with { type: "json" };
import { addAppVersion } from "./vite-plugins/app-version.ts";
import { addContentSecurityPolicy } from "./vite-plugins/content-security-policy.ts";
import { addNotFoundPage } from "./vite-plugins/not-found-page.ts";
import { addTransport } from "./vite-plugins/transport.ts";

// @tursodatabase/database-wasm needs SharedArrayBuffer, so the page must be cross-origin isolated
// in dev and preview too. In production (GitHub Pages, which can't set headers) the service worker
// adds these headers; public/_headers covers hosts that read it.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** Where `pnpm server` listens: the server's default address (crates/server/README.md). */
const SERVER = "http://127.0.0.1:8080";

export default defineConfig({
  // GitHub Pages serves the project site from /week-budget-planner/.
  base: "/week-budget-planner/",
  plugins: [
    solid(),
    addAppVersion(packageJson.repository.url),
    addContentSecurityPolicy({ trustedHtmlFiles: ["src/icons/iconset.svg"] }),
    addNotFoundPage(),
    addTransport(),
  ],
  // Workers are bundled on their own, with their own plugins: the transport's worker imports the
  // module from virtual:transport.
  worker: { format: "es", plugins: () => [addTransport()] },
  build: {
    // No polyfill for <link rel="modulepreload">, which every browser the app supports has: with two
    // pages, Vite would put it in a chunk of its own that the app's page loads for the check page.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      // The transport check runs the transport under the app's headers until the app can turn
      // syncing on (see crates/transport/README.md).
      input: { index: "index.html", "transport-check": "transport-check.html" },
    },
  },
  server: {
    headers: crossOriginIsolation,
    // The server's own paths, so the app in development reaches the server's relay and node on its
    // own origin, as it will in production (pnpm server, see crates/server/README.md). Patterns,
    // since a plain "/node" would also catch /node_modules/.
    proxy: {
      "^/relay$": { target: SERVER, ws: true },
      "^/ping$": { target: SERVER },
      "^/node$": { target: SERVER },
    },
  },
  preview: { headers: crossOriginIsolation },
});
