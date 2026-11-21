// Runs the server on this machine for working on the app (see Running it in
// crates/server/README.md), with a node key of its own in .credentials/ at the repository's root.
//
//   pnpm server
//
// The server itself never makes a key: a missing one stops it (crates/server/src/credential.rs).
// This script makes one the first time, the way a person setting up a server would, and keeps it,
// so the node's id survives restarts as it does in production. The folder ignores itself in Git,
// whatever the root .gitignore says, so the key can't be committed by mistake.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CREDENTIALS = resolve(".credentials");
const NODE_KEY = join(CREDENTIALS, "node-key");
/** The base the app is built for (Vite's `base` in vite.config.ts). */
const BASE = "/week-budget-planner/";

function prepareCredentials(): void {
  if (!existsSync(CREDENTIALS)) {
    mkdirSync(CREDENTIALS, { mode: 0o700 });
    writeFileSync(
      join(CREDENTIALS, ".gitignore"),
      "# The server's credentials on this machine: never committed (see scripts/run-server.ts).\n*\n",
    );
  }

  if (existsSync(NODE_KEY)) return;

  execFileSync("cargo", ["run", "--release", "--locked", "--", "generate-node-key", NODE_KEY], {
    stdio: "inherit",
  });
}

prepareCredentials();
// Ctrl+C reaches the server too, which stops cleanly; its exit then ends this script.
execFileSync("cargo", ["run", "--release", "--locked"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CREDENTIALS_DIRECTORY: CREDENTIALS,
    WEEK_BUDGET_PLANNER_BASE: process.env["WEEK_BUDGET_PLANNER_BASE"] ?? BASE,
  },
});
