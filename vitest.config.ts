import solid from "@solidjs/vite-plugin";
import { configDefaults, defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };
import { appVersion } from "./vite-plugins/app-version.ts";

export default defineConfig({
  plugins: [solid(), appVersion(packageJson.repository.url)],
  resolve: { conditions: ["development", "browser"] },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The browser tests in e2e/ run with Playwright (pnpm test:browser).
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
