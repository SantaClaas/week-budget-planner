import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

/** Where `pnpm transport` (scripts/build-transport.ts) writes the module and its JavaScript. */
const FOLDER = "target/transport-module";
const MODULE_ID = "virtual:transport";

/** The value of `integrity` for a fetch of these bytes: their SHA-384, as browsers check it. */
export const hashIntegrity = (bytes: Uint8Array): string =>
  `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

/** The virtual module's code when the transport was built: the bindings, the module's URL and hash. */
export function buildBindings(integrity: string): string {
  return [
    `import initialize, { Failure, Node } from "/${FOLDER}/transport.js";`,
    `import url from "/${FOLDER}/transport_bg.wasm?url";`,
    `export const bindings = { url, integrity: ${JSON.stringify(integrity)}, initialize, Failure, Node };`,
  ].join("\n");
}

/**
 * Gives the app the transport's WebAssembly module (crates/transport) as `virtual:transport`: the
 * JavaScript wasm-bindgen wrote, the module's URL, and its hash for `fetch` with `integrity`, so the
 * browser refuses bytes that aren't the ones the build made (see Transport under Phase 3 in
 * docs/spec/network.md). Vite gives the module a hash in its name, like any asset.
 *
 * The module needs Rust to build, and `pnpm build` doesn't, so without `pnpm transport` first the
 * virtual module gives `undefined`, the build warns, and the app says syncing isn't available.
 */
export function addTransport(): Plugin {
  const resolvedId = `\0${MODULE_ID}`;
  let root = process.cwd();
  return {
    name: "week-budget-planner:transport",
    configResolved(config) {
      root = config.root;
    },
    resolveId: (id) => (id === MODULE_ID ? resolvedId : null),
    load(id) {
      if (id !== resolvedId) return null;

      const module = path.join(root, FOLDER, "transport_bg.wasm");
      if (existsSync(module) && existsSync(path.join(root, FOLDER, "transport.js"))) {
        this.addWatchFile(module);
        return buildBindings(hashIntegrity(readFileSync(module)));
      }

      this.warn(
        `The transport's module isn't built (${FOLDER}), so syncing won't be available. Run pnpm transport first (it needs Rust, see crates/transport/README.md).`,
      );
      return "export const bindings = undefined;";
    },
  };
}
