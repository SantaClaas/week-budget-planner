# The server

The Week Budget Planner's server, in Rust with [axum](https://github.com/tokio-rs/axum). Today it serves the app's build with the headers the app needs, and nothing else; the relay and the mailbox come later (see [Phase 2](../../docs/spec/network.md#phase-2-self-service) in [`docs/spec/network.md`](../../docs/spec/network.md)). How its code is written is in [`docs/guidelines/rust.md`](../../docs/guidelines/rust.md).

## What it does

- **Serves the build** (`dist/`) under a base path, `/` unless set otherwise. The app's pages (`/`, `/activities`, `/settings`) get `index.html`; any other path under the base gets the app's own 404 page with the status 404; a path outside the base gets a plain 404.
- **Sends the headers the app needs** on every response, the ones the service worker adds on GitHub Pages: cross-origin isolation (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy`), `X-Content-Type-Options` and `Referrer-Policy`. Pages also get the Content Security Policy as a header, taken from the `<meta>` policy the build put in `index.html` with `frame-ancestors 'none'` added, so the two never disagree, and `Permissions-Policy` (see [`docs/spec/security.md`](../../docs/spec/security.md)).
- **Reads every file into memory at startup and compresses it once**, with Brotli and gzip, so no request waits for compression. Files under `assets/` have a hash in their name and are cached for a year; everything else is checked again on each visit, with an entity tag so an unchanged file comes back as "not modified".
- **`/health`** answers `ok` while the server runs.
- **Logs** each request as one line of JSON, and **stops cleanly** on Ctrl+C or the terminate signal, finishing the requests it has.

## Running it

It needs Rust (the version in [`rust-toolchain.toml`](../../rust-toolchain.toml); `rustup` installs it on the first `cargo` command) and a build of the app:

```bash
pnpm build
```

The app is built for GitHub Pages, under `/week-budget-planner/`, so serve it under the same base:

```bash
WEEK_BUDGET_PLANNER_BASE=/week-budget-planner/ cargo run --release
```

Then open <http://127.0.0.1:8080/week-budget-planner/>. Compressing the build takes a few seconds at startup, longer in a debug build.

| Variable | Default | What it sets |
| --- | --- | --- |
| `WEEK_BUDGET_PLANNER_ADDRESS` | `127.0.0.1:8080` | the address and port to listen on |
| `WEEK_BUDGET_PLANNER_APP` | `dist` | the folder of the app's build |
| `WEEK_BUDGET_PLANNER_BASE` | `/` | the path the app was built for (Vite's `base`), with a slash at each end |

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

The browser test builds the app and the server, starts the server, and checks that the app reaches the full storage level with service workers blocked, and that each of the app's pages is served:

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
