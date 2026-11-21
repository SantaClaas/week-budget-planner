# The server

The Week Budget Planner's server, in Rust with [axum](https://github.com/tokio-rs/axum). Today it serves the app's build with the headers the app needs, and nothing else; the relay and the mailbox come later (see [Phase 2](../../docs/spec/network.md#phase-2-self-service) in [`docs/spec/network.md`](../../docs/spec/network.md)). How its code is written is in [`docs/guidelines/rust.md`](../../docs/guidelines/rust.md).

## What it does

- **Serves the build** (`dist/`) under a base path, `/` unless set otherwise. The app's pages (`/`, `/activities`, `/settings`) get `index.html`; any other path under the base gets the app's own 404 page with the status 404; a path outside the base gets a plain 404.
- **Sends the headers the app needs** on every response, the ones the service worker adds on GitHub Pages: cross-origin isolation (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy`), `X-Content-Type-Options` and `Referrer-Policy`. Pages also get the Content Security Policy as a header, and `Permissions-Policy`. The build writes the policy for the header to `content-security-policy.txt` next to `index.html`: the same policy it puts in the page's `<meta>`, with `frame-ancestors 'none'` added, so the two never disagree. The server reads that file at startup (see [`docs/spec/security.md`](../../docs/spec/security.md)).
- **Sends the copies the build compressed.** `pnpm compress` ([`scripts/compress.ts`](../../scripts/compress.ts)) writes a Brotli, a zstd and a gzip copy next to each file that shrinks, at each one's smallest setting, since time at build costs no visitor anything. The server sends the copy the browser takes, through tower-http's `ServeDir`, and the file itself to one that takes none. The idea is from pumpe in [SantaClaas/meal](https://github.com/SantaClaas/meal/tree/main/pumpe); Node's own `zlib` does the work here, so the app's build needs no Rust.
- **Caching:** files under `assets/` have a hash in their name and are cached for a year; everything else is checked again on each visit, with an entity tag so an unchanged file comes back as "not modified".
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

The app is built for GitHub Pages, under `/week-budget-planner/`, so serve it under the same base:

```bash
WEEK_BUDGET_PLANNER_BASE=/week-budget-planner/ cargo run --release
```

Then open <http://127.0.0.1:8080/week-budget-planner/>.

| Variable | Default | What it sets |
| --- | --- | --- |
| `WEEK_BUDGET_PLANNER_ADDRESS` | `127.0.0.1:8080` | the address and port to listen on |
| `WEEK_BUDGET_PLANNER_APP` | `dist` | the folder of the app's build |
| `WEEK_BUDGET_PLANNER_BASE` | `/` | the path the app was built for (Vite's `base`), with a slash at each end |

**While working on the app**, `pnpm dev` stays the way to run it: Vite's dev server serves the app, with its hot reload, and once the server has paths of its own for the app to call (the relay, later the mailbox), Vite proxies those to the server (`server.proxy` in [`vite.config.ts`](../../vite.config.ts)), so both run side by side on one origin. In production the server serves both.

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
