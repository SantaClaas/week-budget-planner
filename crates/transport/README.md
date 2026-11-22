# The transport

The browser's side of the transport: an iroh node built from the [`iroh`](https://crates.io/crates/iroh) crate (1.4.1) into a WebAssembly module of our own with wasm-bindgen, with no npm wrapper around iroh. Why iroh, and what a browser node can and can't do, is in Transport under [Phase 3](../../docs/spec/network.md#phase-3-table-service-the-server) in [`docs/spec/network.md`](../../docs/spec/network.md). How the Rust is written is in [`docs/guidelines/rust.md`](../../docs/guidelines/rust.md).

## What it does

Its interface says nothing about syncing ([`src/lib.rs`](src/lib.rs), [`src/connection.rs`](src/connection.rs)):

- **`Node.spawn(secretKey, relayUrl, timeout)`** makes a node from its 32 secret bytes and waits until it has reached the relay. The node knows only that one relay and looks up no addresses: no n0 relays, no n0 DNS.
- **`node.connect(nodeId, protocol, timeout)`** connects to another node by its id, through the relay, for one protocol.
- **`connection.open(timeout)`** opens a stream; **`stream.send(bytes, timeout)`**, **`stream.finish()`** and **`stream.receive(limit, timeout)`** send and receive bytes on it; **`connection.close()`** and **`node.close()`** close.
- **Every call that waits on the network takes a deadline**, in milliseconds, since iroh waits silently when something blocks it.
- **A failure is a value**: a `Failure` with a `type` (`"timeout"`, `"unreachable"`, `"closed"` or `"invalid"`) for the app to decide on and put into words ("Can't reach the server"), and a `message` for the console ([`src/failure.rs`](src/failure.rs)).

## Where it runs

**In a dedicated worker of its own** ([`src/transport/worker.ts`](../../src/transport/worker.ts)), which the page starts and calls over a `MessagePort` ([`src/transport/index.ts`](../../src/transport/index.ts)). Every call there gives back a `Result`, and the page keeps a deadline of its own a second longer than the worker's, so even a worker that stops answering ends in `"timeout"`.

- **The page holds handles, and they clean up with `await using`.** A connection's `[Symbol.asyncDispose]` disconnects, which also releases its streams, and a stream's releases it: the worker frees it, and dropping it in the module finishes what it sends, so it's still delivered, and tells the other side to stop sending. In the module itself, every class already has wasm-bindgen's `[Symbol.dispose]`, which frees it the same way.
- **The transport check doesn't use `await using`:** the bundler would move the helper that lowers it into a chunk shared with the app's page, which would then load one more file on a normal start. It disconnects explicitly.

- **Not the leader tab's main thread,** although the spec gives the leader the node's keys and the one connection. Browsers throttle timers in hidden tabs, Chrome down to once a minute after a while, and a leader tab is often hidden; the relay connection's keep-alives and the app's deadlines run on timers, and workers are throttled far less. A worker also keeps iroh's work off the thread that draws the week.
- **Beside the database's worker, not inside it:** the database worker is Turso's, and a module of its own can start, fail and stop without touching the plan's storage.
- **The leader starts it, and the other tabs reach it through the leader,** as they reach the database (see [`docs/guidelines/database.md`](../../docs/guidelines/database.md)). That wiring comes with the first thing that syncs; until then the transport check below is the only page that starts it.

## When the sync protocol comes

The page reaches a stream through calls (`send`, `finish`, `receive`, `release`), each giving back a `Result`, which is enough for the transport check's one echo. The sync protocol is the first real reader, so its needs decide the stream API. Where to start then:

- **Web Streams, in WebTransport's shape:** the worker hands the page a stream as `{ readable, writable }`, transferred through `postMessage`, so the platform's own tools apply: `pipeThrough` with a `TransformStream`, `pipeTo` with backpressure, and `for await` over the readable. wasm-bindgen's stream adapters (`IntoUnderlyingSource` and the rest, already in the generated types) cover the Rust side.
- **Check first:** whether Safari transfers streams through `postMessage`, which decides the design. A stream's failure is an error rather than a value, so the `Problem`s would travel as rejection reasons and be read back at the edge. And a deadline per call becomes `AbortSignal.timeout()` on a pipe.
- **An async generator for the framing:** an `async function*` that reads bytes and yields whole messages, which the protocol reads with `for await`. `Array.fromAsync` and `ReadableStream.from()` fit around it. Iterator helpers for async iterators aren't in browsers yet.

## How it's built

**CI builds it, and nothing built is committed.** `pnpm transport` ([`scripts/build-transport.ts`](../../scripts/build-transport.ts)) compiles the crate for `wasm32-unknown-unknown` with the size profile (`[profile.transport]` in [`Cargo.toml`](../../Cargo.toml)), then wasm-bindgen writes the module and the JavaScript that loads it into `target/transport-module/`, where [`vite-plugins/transport.ts`](../../vite-plugins/transport.ts) picks them up for `pnpm build`.

- **Why not commit the module:** a 2.6 MB binary in Git with every iroh update, which a review can't read and nothing proves was built from this source.
- **`pnpm build` doesn't need Rust:** without `pnpm transport` first, the build warns, and the app's transport says `"unavailable"`. GitHub Pages builds that way, since it has no relay to reach. The server's browser test ([`.github/workflows/server.yml`](../../.github/workflows/server.yml)) builds the module first.
- **Shipping the server and the app as one container**, with the module built inside it, is the next step for production ([SantaClaas/week-budget-planner#134](https://github.com/SantaClaas/week-budget-planner/issues/134)). With that, revisit the module as a package of the pnpm workspace, whose types would be wasm-bindgen's own instead of the ones written by hand in [`src/transport/bindings.ts`](../../src/transport/bindings.ts). It only pays off once every build has Rust: until then the package would be empty wherever `pnpm build` runs without it, and the Vite plugin still has to write in the module's hash.

It needs Rust (with the `wasm32-unknown-unknown` target, which [`rust-toolchain.toml`](../../rust-toolchain.toml) installs) and wasm-bindgen-cli at the version of the `wasm-bindgen` crate in [`Cargo.lock`](../../Cargo.lock), which the script checks:

```bash
cargo install --locked wasm-bindgen-cli@0.2.130
```

```bash
pnpm transport
```

The module comes out at 2.6 MB, 743 KB with Brotli, and its JavaScript at 55 KB, 8 KB with Brotli (2026-11-21). The spike's 668 KB had binaryen's `wasm-opt -Oz` on top, which isn't used yet: it would be one more tool to install and pin ([SantaClaas/week-budget-planner#135](https://github.com/SantaClaas/week-budget-planner/issues/135)).

## How it's loaded

**Only when something starts the transport, never on a normal start** (see [`docs/LOADING.md`](../../docs/LOADING.md)). `start()` starts the worker, and the worker fetches the module on its first call, **by its hash**: the plugin writes the module's SHA-384 into the code, and the worker fetches it with `fetch(url, { integrity })`, so the browser refuses bytes that aren't the ones the build made. Vite gives the module a hash in its name like any other asset, so a new build is never served from an old cache.

The database's module isn't loaded by hash: `@tursodatabase/database-wasm` fetches its own module as soon as it's imported (`fetch(new URL("./turso.wasm32-wasi.wasm", import.meta.url))` in its `dist/index-default.js`, 0.8.3), with no way to pass a hash or a response. It would take a patch of the package, which isn't cheap to keep up with its releases.

## The transport check

[`transport-check.html`](../../transport-check.html) ([`src/transport/check.ts`](../../src/transport/check.ts)) is a second page of the build, served with the same headers and policy as the app. It starts the worker, connects to the server's node, and sends bytes that the node's echo protocol sends back ([`crates/server/src/node.rs`](../server/src/node.rs)), then shows `echoed` or what went wrong. "Send again" echoes once more with the same node. `?timeout=<milliseconds>` sets each step's deadline, 10 s without it; a value that isn't a whole number above zero ends the check in `invalid-timeout` rather than falling back. The app's page shares no code with it, so it loads nothing more for it.

## Checking it

```bash
cargo clippy --locked --package week-budget-planner-transport --target wasm32-unknown-unknown -- --deny warnings
```

The native checks in [`crates/server/README.md`](../server/README.md) cover this crate too, and its unit tests run natively. The browser tests in [`e2e/transport.spec.ts`](../../e2e/transport.spec.ts) run with `pnpm test:server`, against the server: the echo from the worker under the policy, Trusted Types and cross-origin isolation, a relay that never answers and a missing one ending in the timeout, the relay dropping and coming back, and the app's normal start asking for nothing of the transport's. Playwright can't route a worker's WebSockets, so the relay tests load the page through a small proxy in front of the server ([`e2e/relay-proxy.ts`](../../e2e/relay-proxy.ts)).
