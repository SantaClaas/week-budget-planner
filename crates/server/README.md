# The server

The Week Budget Planner's server, in Rust with [axum](https://github.com/tokio-rs/axum). It serves the app's build with the headers the app needs, and runs the iroh relay and the server's own node that syncing will connect through; the sync protocol and the mailbox come later (see [Phase 2](../../docs/spec/network.md#phase-2-self-service) and Transport under [Phase 3](../../docs/spec/network.md#phase-3-table-service-the-server) in [`docs/spec/network.md`](../../docs/spec/network.md)). How its code is written is in [`docs/guidelines/rust.md`](../../docs/guidelines/rust.md).

## What it does

- **Serves the build** (`dist/`) under a base path, `/` unless set otherwise. The app's pages (`/`, `/activities`, `/settings`) get `index.html`; any other path under the base gets the app's own 404 page with the status 404; a path outside the base gets a plain 404.
- **Sends the headers the app needs** on every response, the ones the service worker adds on GitHub Pages: cross-origin isolation (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy`), `X-Content-Type-Options` and `Referrer-Policy`. Pages also get the Content Security Policy as a header, and `Permissions-Policy`. The policy is compiled into the server from [`content-security-policy.txt`](../../content-security-policy.txt), the page's `<meta>` policy with `frame-ancestors 'none'` added, which `pnpm policy` writes from `index.html` and which is committed, so the server builds without the app (see [`docs/spec/security.md`](../../docs/spec/security.md)).
- **Sends the copies the build compressed.** `pnpm compress` ([`scripts/compress.ts`](../../scripts/compress.ts)) writes a Brotli, a zstd and a gzip copy next to each file that shrinks, at each one's smallest setting, since time at build costs no visitor anything. The server sends the copy the browser takes, through tower-http's `ServeDir`, and the file itself to one that takes none. The idea is from pumpe in [SantaClaas/meal](https://github.com/SantaClaas/meal/tree/main/pumpe); Node's own `zlib` does the work here, so the app's build needs no Rust.
- **Caching:** files under `assets/` have a hash in their name and are cached for a year; everything else is checked again on each visit, with an entity tag so an unchanged file comes back as "not modified".
- **Runs the iroh relay** ([`iroh-relay`](https://crates.io/crates/iroh-relay), 1.4.1) in the same process, on the app's origin, so the Content Security Policy needs no new entry. A browser node reaches it with a `fetch` to `/ping` and a WebSocket to `/relay`. `/relay` is an ordinary axum route: axum upgrades the request to a WebSocket, over HTTP/1.1 or HTTP/2, and the connection then goes through iroh-relay's own handshake, access control and client registry, the same steps its built-in server takes after an upgrade ([`src/relay.rs`](src/relay.rs)). So it also works behind a proxy that reuses connections. The relay admits every node for now; its access control already takes a list of node ids, which the mailbox's member list will set (#97). It could also run as a service of its own behind a proxy, if that's ever needed.
- **Runs the server's own iroh node** behind that relay, with no address lookup and no relay but ours. It tells the app its id at `/node` (`{"nodeId":"…"}`). Its key comes from the server's credentials, not its configuration (see [Secrets](#secrets)), so a restart keeps the id. It reaches the relay about 3 s after the server starts. No protocol runs on it yet: it answers `week-budget-planner/echo/0`, which sends back what a stream sends, so the browser's side can be tested end to end ([`src/node.rs`](src/node.rs)).
- **`/health`** answers `ok` while the server runs.
- **Logs** each request as one line of JSON, and **stops cleanly** on Ctrl+C or the terminate signal, finishing the requests it has.

## Running it

It needs Rust (the version in [`rust-toolchain.toml`](../../rust-toolchain.toml); `rustup` installs it on the first `cargo` command) and a build of the app, compressed:

```bash
pnpm build
```

```bash
pnpm compress
```

The first run takes about half a minute, nearly all of it Brotli on the database engine's WebAssembly module. Each copy is kept in `node_modules/.cache/compress/` by the hash of its file's content, so later runs take about a second, until a file changes: the module only does when the engine is updated. CI keeps the cache between runs too, with `actions/cache`. Without compressing, the server sends every file as it is.

The server needs a node key, which it reads from its credentials (see [Secrets](#secrets) below) and never makes itself. Make one once, in a folder outside the repository:

```bash
mkdir -p ~/.local/share/week-budget-planner/credentials
```

```bash
cargo run --release -- generate-node-key ~/.local/share/week-budget-planner/credentials/node-key
```

The app is built for GitHub Pages, under `/week-budget-planner/`, so serve it under the same base:

```bash
CREDENTIALS_DIRECTORY=~/.local/share/week-budget-planner/credentials WEEK_BUDGET_PLANNER_BASE=/week-budget-planner/ cargo run --release
```

Then open <http://127.0.0.1:8080/week-budget-planner/>.

| Variable | Default | What it sets |
| --- | --- | --- |
| `WEEK_BUDGET_PLANNER_ADDRESS` | `127.0.0.1:8080` | the address and port to listen on |
| `WEEK_BUDGET_PLANNER_APP` | `dist` | the folder of the app's build |
| `WEEK_BUDGET_PLANNER_BASE` | `/` | the path the app was built for (Vite's `base`), with a slash at each end |

**While working on the app**, `pnpm dev` stays the way to run it: Vite's dev server serves the app, with its hot reload, and once the server has paths of its own for the app to call (the relay, later the mailbox), Vite proxies those to the server (`server.proxy` in [`vite.config.ts`](../../vite.config.ts)), so both run side by side on one origin. In production the server serves both.

## Secrets

**The server's secrets are kept apart from its configuration**: the variables above name none, not even a secret's path. Today the one secret is the node key, which lets whoever has it act as the server's node ([`src/credential.rs`](src/credential.rs)).

- **The server reads it from `$CREDENTIALS_DIRECTORY/node-key`,** where systemd puts a service's credentials: `LoadCredential=node-key:/etc/week-budget-planner/node-key` in the unit makes the key readable to the service only, for as long as it runs. A container can do the same by mounting a secret file into a folder and setting `CREDENTIALS_DIRECTORY` to it.
- **The server never makes it.** Without the variable or the key it refuses to start and says where it looked, so a wrong path or a lost file can't quietly give the server a new identity. A restart keeps the key, and so the node's id, so a connected browser only waits for the server to come back.
- **`week-budget-planner-server generate-node-key <file>` makes one** when a server is set up: 32 random bytes as 64 hexadecimal digits, in a new file readable by its owner only. It refuses to write over a file that exists.
- **It's never logged:** iroh prints a secret key as `SecretKey(..)`. The browser test makes a key of its own in a temporary folder.

## Checking it

```bash
cargo fmt --check
```

```bash
cargo clippy --all-targets --locked -- --deny warnings
```

```bash
cargo test --locked
```

The browser test builds and compresses the app, builds the server, starts it, and checks that the app reaches the full storage level with service workers blocked, that each of the app's pages is served, and that the compressed copies are sent:

```bash
pnpm test:server
```

The supply chain checks need [cargo-deny](https://github.com/EmbarkStudios/cargo-deny) (`cargo install --locked cargo-deny@0.20.2`):

```bash
cargo deny --locked check
```

```bash
node scripts/check-crate-age.ts
```

CI runs all of them in [`.github/workflows/server.yml`](../../.github/workflows/server.yml).
