// Builds the transport's WebAssembly module (crates/transport) for the app: Cargo compiles the crate
// for the browser with the size profile, and wasm-bindgen writes the module and the JavaScript that
// loads it into target/transport-module/, where vite-plugins/transport.ts picks them up. It needs
// Rust, so only builds that ship syncing run it (see crates/transport/README.md); `pnpm build`
// without it gives an app whose transport is unavailable.
//
//   node scripts/build-transport.ts
//
// wasm-bindgen-cli has to be the same version as the wasm-bindgen crate in Cargo.lock, or the
// JavaScript it writes doesn't fit the module, so this checks it first.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { constants, brotliCompressSync } from "node:zlib";

const CRATE = "week-budget-planner-transport";
const PROFILE = "transport";
const TARGET = "wasm32-unknown-unknown";
/** Where the module and its JavaScript go: inside Cargo's build output, which Git ignores. */
const OUTPUT = join("target", "transport-module");
/** The name of the files wasm-bindgen writes: transport.js, transport_bg.wasm and their types. */
const OUTPUT_NAME = "transport";

/** The version of a crate in Cargo.lock's text, or undefined when it isn't there. */
export function findLockedVersion(lockfile: string, name: string): string | undefined {
  const pattern = new RegExp(
    `\\[\\[package\\]\\]\\nname = "${RegExp.escape(name)}"\\nversion = "([^"]+)"`,
    "u",
  );
  return pattern.exec(lockfile)?.[1];
}

function run(command: string, parameters: readonly string[]): string {
  return execFileSync(command, parameters, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function checkWasmBindgen(): void {
  const locked = findLockedVersion(readFileSync("Cargo.lock", "utf8"), "wasm-bindgen");
  if (locked === undefined) throw new Error("Cargo.lock has no wasm-bindgen.");

  let installed: string;
  try {
    installed = run("wasm-bindgen", ["--version"]).trim();
  } catch {
    throw new Error(
      `wasm-bindgen isn't installed. Install it with: cargo install --locked wasm-bindgen-cli@${locked}`,
    );
  }

  if (installed !== `wasm-bindgen ${locked}`) {
    throw new Error(
      `${installed} doesn't match wasm-bindgen ${locked} in Cargo.lock. Install it with: cargo install --locked wasm-bindgen-cli@${locked}`,
    );
  }
}

function formatKilobytes(bytes: number): string {
  return `${(bytes / 1000).toFixed(0)} KB`;
}

function reportSize(path: string): void {
  const bytes = readFileSync(path);
  const brotli = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  });
  console.log(
    `${path}: ${formatKilobytes(statSync(path).size)}, ${formatKilobytes(brotli.length)} with Brotli`,
  );
}

function build(): void {
  checkWasmBindgen();
  execFileSync(
    "cargo",
    ["build", "--locked", "--package", CRATE, "--target", TARGET, "--profile", PROFILE],
    { stdio: "inherit" },
  );
  rmSync(OUTPUT, { recursive: true, force: true });
  const module = join("target", TARGET, PROFILE, `${CRATE.replaceAll("-", "_")}.wasm`);
  execFileSync(
    "wasm-bindgen",
    [
      module,
      "--out-dir",
      OUTPUT,
      "--out-name",
      OUTPUT_NAME,
      "--target",
      "web",
      "--weak-refs",
      "--remove-name-section",
      "--remove-producers-section",
    ],
    { stdio: "inherit" },
  );
  reportSize(join(OUTPUT, `${OUTPUT_NAME}_bg.wasm`));
  reportSize(join(OUTPUT, `${OUTPUT_NAME}.js`));
}

if (import.meta.main) build();
