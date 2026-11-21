import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * The browser test for the Rust server (crates/server): the app served by it, as it will be in
 * production. Run with `pnpm test:server`, which builds the app and the server first. It's apart
 * from playwright.config.ts so that `pnpm test:browser` needs no Rust toolchain.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];

/**
 * A credentials folder of the run's own, outside the repository, as systemd gives a service one:
 * the server reads its node key from there and never makes one itself (crates/server/README.md).
 */
const credentials = mkdtempSync(join(tmpdir(), "week-budget-planner-credentials-"));
const server = "./target/release/week-budget-planner-server";

export default defineConfig({
  testDir: "e2e",
  testMatch: "server.spec.ts",
  forbidOnly: process.env["CI"] !== undefined,
  globalTimeout: process.env["CI"] === undefined ? 0 : 5 * 60_000,
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
  webServer: {
    command: `${server} generate-node-key ${join(credentials, "node-key")} && ${server}`,
    env: {
      CREDENTIALS_DIRECTORY: credentials,
      WEEK_BUDGET_PLANNER_ADDRESS: "127.0.0.1:4313",
      WEEK_BUDGET_PLANNER_BASE: "/week-budget-planner/",
    },
    url: "http://127.0.0.1:4313/health",
    reuseExistingServer: false,
    // Compressing the build at startup takes a few seconds.
    timeout: 60_000,
  },
});
