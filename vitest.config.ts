import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

import packageJson from "./package.json" with { type: "json" };
import { appVersion } from "./vite-plugins/app-version.ts";

export default defineConfig({
  plugins: [solid(), appVersion(packageJson.repository.url)],
  resolve: { conditions: ["development", "browser"] },
  test: { environment: "node", setupFiles: ["./vitest.setup.ts"] },
});
