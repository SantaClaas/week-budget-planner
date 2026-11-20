# iroh in the browser: spike for issue #80

Throwaway code that answers whether iroh works in a browser for this app. Nothing here is part of the app or gets merged into it.

- [`browser/`](browser/): our own crate, built from the `iroh` crate (1.4.1) to `wasm32-unknown-unknown` with wasm-bindgen. It binds an endpoint, dials another endpoint by public key and echoes bytes, and accepts the same echo protocol so two browser nodes can reach each other.
- [`server/`](server/): native stand-in for the sync server. It runs an iroh relay of our own (plain HTTP on `localhost:3340`) and a native iroh endpoint behind it in one process. With `PUBLIC=1` it skips the relay and uses n0's public relays and pkarr address lookup instead.
- [`web/`](web/): the test page and worker, and `serve.mjs`, a static server that sends the app's headers (COOP/COEP and the Content Security Policy from [`docs/spec/security.md`](../../docs/spec/security.md) with Trusted Types, as headers) and forwards `/relay` and `/ping` to the relay, so the relay can also be reached on the page's own origin.
- [`protocol-check/`](protocol-check/): only checks that iroh-gossip, iroh-blobs and iroh-docs compile for the browser target.
- [`run.mjs`](run.mjs): starts everything and runs the scenarios in headless Chromium, Firefox and WebKit through Playwright, then has a page in each engine dial a page in each other engine, printing JSON (issue #94).

## Run it

Needs Rust with `wasm32-unknown-unknown`, `wasm-bindgen-cli` at the version of the `wasm-bindgen` crate in `Cargo.lock` (0.2.130), optionally `wasm-opt` (binaryen), Node, and Playwright with Chromium.

```sh
cargo install wasm-bindgen-cli --version =0.2.130 --locked
./build.sh                      # builds both sides and prints the module's size
NODE_PATH=/opt/node-tools/node_modules node run.mjs            # local relay scenarios
PUBLIC=1 NODE_PATH=/opt/node-tools/node_modules node run.mjs   # n0's public relays
cargo check -p spike-protocol-check --target wasm32-unknown-unknown --features gossip  # or blobs, docs
```

`NODE_PATH` points to wherever Playwright is installed; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides the Chromium path (default `/opt/pw-browsers/chromium`). `ENGINES=firefox,webkit` runs a subset (default: all three), and `PLAYWRIGHT_MODULE=@playwright/test` loads Playwright through the repository's own `@playwright/test`.

### Firefox and WebKit (issue #94)

The repository's Playwright (1.64.1) brings its own Firefox and WebKit builds. Install them outside `/opt/pw-browsers` so the preinstalled Chromium stays as it is, then run from the repository root so `@playwright/test` resolves:

```sh
export PLAYWRIGHT_BROWSERS_PATH=/some/scratch/pw-browsers
PW=node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/cli.js
node $PW install firefox webkit
node $PW install-deps firefox webkit   # WebKit's system libraries, through apt
PLAYWRIGHT_MODULE=@playwright/test node spike/iroh/run.mjs
```

The repository pins Rust 1.97.0 in `rust-toolchain.toml`, so the target goes on that toolchain: `rustup target add wasm32-unknown-unknown --toolchain 1.97.0`.

Results on 2026-11-20 (Chromium 153.0.8010.12, Firefox 157.0, WebKit 27.2; three runs each), with times from page load in ms as online / first echo:

| Scenario | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Page, relay on another origin, `connect-src` allows it | ok, 271–288 / 321–331 | ok, 318–431 / 344–445 | ok, 288–303 / 313–336 |
| Worker, relay on another origin, `connect-src` allows it | ok, 254–257 / 292–296 | ok, 259–299 / 272–315 | ok, 264–274 / 291–300 |
| Page, `connect-src` for the relay's WebSocket only | blocked (`/ping`) | blocked (`/ping`) | **ok**: `ws://host` also covers `http://host` |
| Page, relay on another origin, the app's policy unchanged | blocked (`/ping`, as expected) | blocked | blocked |
| Page, relay on the page's origin, the app's policy unchanged | ok, 286–312 / 331–355 | ok, 275–298 / 288–313 | ok, 286–294 / 316–319 |
| Worker, relay on the page's origin, the app's policy unchanged | ok, 275–276 / 316–351 | ok, 257–284 / 269–321 | ok, 260–297 / 285–362 |
| Page dials a page in the same engine | ok, 272–395 / 336–536 | ok, 269–334 / 289–363 | ok, 260–299 / 299–386 |

A page in each engine also dialed a page in each other engine (six pairs), all ok, first echo 305–427 ms. In every engine the page and the worker were cross-origin isolated, Trusted Types existed and the policy enforced them (an HTML string assigned to `innerHTML` threw), and the wasm module needed only `'wasm-unsafe-eval'`. n0's public relays weren't tried in Firefox or WebKit.
