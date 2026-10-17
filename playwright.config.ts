import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the sensitive paths, the ones a failure would cost the user their plan (see
 * Where rules are enforced in docs/CODING-GUIDELINES.md). They run against the built app, so run
 * `pnpm build` first (`pnpm test:browser` does both).
 *
 * CI installs the browser that matches this Playwright version. Elsewhere, an installed Chromium
 * can be used instead by setting PLAYWRIGHT_CHROMIUM_EXECUTABLE to its path.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];

export default defineConfig({
  testDir: "e2e",
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: process.env["CI"] === undefined ? "list" : "github",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath !== undefined && { launchOptions: { executablePath } }),
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/static-server.ts --port 4311 --isolated",
      port: 4311,
      reuseExistingServer: false,
    },
    { command: "node e2e/static-server.ts --port 4312", port: 4312, reuseExistingServer: false },
  ],
});
