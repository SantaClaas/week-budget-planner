#!/usr/bin/env bash
# Builds the spike: the native server and the WebAssembly module, then
# reports the module's size raw, gzip and brotli, before and after wasm-opt.
#
# Needs: Rust with the wasm32-unknown-unknown target, wasm-bindgen-cli at the
# same version as the wasm-bindgen crate in Cargo.lock, and optionally
# wasm-opt (binaryen) on PATH.
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release -p spike-server
cargo build --release -p spike-browser --target wasm32-unknown-unknown

rm -rf web/pkg
wasm-bindgen target/wasm32-unknown-unknown/release/spike_browser.wasm \
  --out-dir web/pkg --target web --weak-refs

report() {
  node -e '
    const { readFileSync } = require("node:fs");
    const zlib = require("node:zlib");
    const bytes = readFileSync(process.argv[1]);
    const gzip = zlib.gzipSync(bytes, { level: 9 }).length;
    const brotli = zlib.brotliCompressSync(bytes, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
    console.log(`${process.argv[2].padEnd(30)} raw ${bytes.length}  gzip-9 ${gzip}  brotli-11 ${brotli}`);
  ' "$1" "$2"
}

report web/pkg/spike_browser_bg.wasm "wasm (wasm-bindgen output)"
if command -v wasm-opt > /dev/null; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int \
    --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue \
    -o web/pkg/spike_browser_bg.wasm web/pkg/spike_browser_bg.wasm
  report web/pkg/spike_browser_bg.wasm "wasm (after wasm-opt -Oz)"
fi
report web/pkg/spike_browser.js "JavaScript glue"
