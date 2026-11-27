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

/**
 * The mode that adds the transport check (transport-check.html) to the build, for the server's
 * browser tests (`pnpm build:transport-check`, which `pnpm test:server` runs). The app's own build
 * leaves it out: two entries in one build share their common code as chunks of its own, which the
 * app's page would then load at start, and the check page has nothing to reach on GitHub Pages.
 */
const TRANSPORT_CHECK = "transport-check";

export default defineConfig(({ mode }) => ({
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
    rolldownOptions: {
      // The transport check runs the transport under the app's headers until the app can turn
      // syncing on (see crates/transport/README.md).
      input:
        mode === TRANSPORT_CHECK
          ? { index: "index.html", "transport-check": "transport-check.html" }
          : { index: "index.html" },
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
}));
