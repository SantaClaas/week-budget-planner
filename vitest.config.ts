import solid from "@solidjs/vite-plugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["development", "browser"] },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The browser tests in e2e/ run with Playwright (pnpm test:browser).
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
