# iroh in the browser: spike for issue #80

Throwaway code that answers whether iroh works in a browser for this app. Nothing here is part of the app or gets merged into it.

- [`browser/`](browser/): our own crate, built from the `iroh` crate (1.4.1) to `wasm32-unknown-unknown` with wasm-bindgen. It binds an endpoint, dials another endpoint by public key and echoes bytes, and accepts the same echo protocol so two browser nodes can reach each other.
- [`server/`](server/): native stand-in for the sync server. It runs an iroh relay of our own (plain HTTP on `localhost:3340`) and a native iroh endpoint behind it in one process. With `PUBLIC=1` it skips the relay and uses n0's public relays and pkarr address lookup instead.
- [`web/`](web/): the test page and worker, and `serve.mjs`, a static server that sends the app's headers (COOP/COEP and the Content Security Policy from [`docs/spec/security.md`](../../docs/spec/security.md) with Trusted Types, as headers) and forwards `/relay` and `/ping` to the relay, so the relay can also be reached on the page's own origin.
- [`protocol-check/`](protocol-check/): only checks that iroh-gossip, iroh-blobs and iroh-docs compile for the browser target.
- [`run.mjs`](run.mjs): starts everything and runs the scenarios in headless Chromium through Playwright, printing JSON.

## Run it

Needs Rust with `wasm32-unknown-unknown`, `wasm-bindgen-cli` at the version of the `wasm-bindgen` crate in `Cargo.lock` (0.2.130), optionally `wasm-opt` (binaryen), Node, and Playwright with Chromium.

```sh
cargo install wasm-bindgen-cli --version =0.2.130 --locked
./build.sh                      # builds both sides and prints the module's size
NODE_PATH=/opt/node-tools/node_modules node run.mjs            # local relay scenarios
PUBLIC=1 NODE_PATH=/opt/node-tools/node_modules node run.mjs   # n0's public relays
cargo check -p spike-protocol-check --target wasm32-unknown-unknown --features gossip  # or blobs, docs
```

`NODE_PATH` points to wherever Playwright is installed; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides the Chromium path (default `/opt/pw-browsers/chromium`).
