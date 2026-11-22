---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
  - "Cargo.lock"
  - "rust-toolchain.toml"
  - "deny.toml"
  - "crates/**"
---

# Rust

How the Rust in this project is named, split, checked and kept safe to depend on. It adds to [`docs/guidelines/principles.md`](principles.md), which always applies: much of it already cites Rust (modules and visibility, `Result` and panics, `unsafe` and its `// SAFETY:` comment, routers that nest like modules), and this file only adds what's specific to Rust here. The server's design is in [`docs/spec/network.md`](../spec/network.md).

## Layout

- **One Cargo workspace at the repository's root**, with each crate in [`crates/`](../../crates/), named for what it is: [`crates/server/`](../../crates/server/) today, and the browser module and the protocol beside it later. `crates/` is a folder name Rust people and tools expect, like `docs/` (see Modules in [`principles.md`](principles.md)).
- **The toolchain is pinned** in [`rust-toolchain.toml`](../../rust-toolchain.toml), with `rustfmt` and `clippy`, so everyone and CI build with the same compiler, as [`.node-version`](../../.node-version) does for Node. A new Rust release is taken by changing that file, a week after the release, like any dependency.
- **What every crate shares is set once in the workspace's [`Cargo.toml`](../../Cargo.toml):** the edition, the lints and the dependencies' versions (`[workspace.dependencies]`). A crate takes them with `workspace = true`.
- **The app's build doesn't depend on Rust.** `pnpm build` and the app's checks run without a Rust toolchain, and the Rust checks run as jobs of their own.

## Names

- **Rust's own conventions come first**, since they're the platform's names (see Names in [`principles.md`](principles.md)): `snake_case` for functions, variables and modules, `UpperCamelCase` for types and traits, `SCREAMING_SNAKE_CASE` for constants. The [API guidelines](https://rust-lang.github.io/api-guidelines/naming.html) are part of that: a constructor is `new`, a getter is named for what it gets without `get_` (`base()`, `len()`), and conversions are `as_`, `to_` and `into_`. These are the places a function doesn't start with a verb.
- **Everything else from the principles holds:** no abbreviations (`request`, not `req`; `response`, not `res`; `address`, not `addr`), functions start with a verb, and booleans are questions that start with `is_`. A library's own abbreviations stay at its edge (`tokio::net::TcpListener::local_addr`).
- **Modules are named in the singular** and their items drop the module's noun: `header::build`, not `header::build_headers`.

## Modules and visibility

- **A module is a file; when it grows, it gets a folder of the same name** beside it, with its submodules inside: `asset.rs` and `asset/encoding.rs`. No `mod.rs`, so a module's file is always named for it, the way `broadcast.ts` becomes `broadcast/index.ts` in the app.
- **Visibility is as narrow as it can be.** Items are private by default; `pub(crate)` for what other modules of the crate use; `pub` only for the crate's own interface. Rust enforces what TypeScript can only ask for (see Coupling in [`principles.md`](principles.md)), so use it.
- **A module builds its own router and exports only that**, as Vertical first in [`principles.md`](principles.md) describes: handlers stay private, and `main` merges a few routers instead of listing every handler.
- **Declare before use** holds as in the principles, although Rust doesn't need it: types, constants and helpers first, the module's entry point last, and its `#[cfg(test)] mod test` at the very end.

## Errors

- **What can fail returns a `Result`**, and its error says what went wrong as a value: an enum per module, made with [`thiserror`](https://docs.rs/thiserror), whose variants are the outcomes a caller can act on. No `Box<dyn Error>` and no `anyhow` in a library crate; a binary's `main` may report one error type of its own.
- **A panic is for a bug**, as a throw is for what nobody planned for in [`docs/guidelines/typescript.md`](typescript.md). `unwrap()`, `expect()`, `panic!`, `todo!` and `unimplemented!` are lint errors outside tests. Where one is right, because the program can't go on and the reason is known, the line says why with `#[expect(clippy::expect_used, reason = "…")]` and `expect()` says what was expected.
- **`?` takes the place of one operation per `try`**: each fallible call is its own `?`, and a `map_err` turns the error into the module's own where the meaning changes.
- **Return early.** `let … else { return … };` and a guard `if` handle the special case first, and the main path goes on unindented, as Return early instead of `else` in [`principles.md`](principles.md) asks. `if … { … } else { … }` as an expression that chooses between two values is the ternary's place, and is fine.

## The pure core and the edges, for async code

- **The logic is plain functions and plain state machines**: they take what happened (a request, a message, the time) and return what to do, without `async`, I/O, a clock or randomness inside. They're tested with input and expected output, with no runtime.
- **The edges are async and thin:** an axum handler or an actor reads its input, calls the core, and does what comes back. The clock and new ids are passed in, from the edge, as in the app (see A pure core, with side effects at the edges in [`principles.md`](principles.md)).
- **Never hold a lock across an `.await`.** State that tasks share belongs to an actor (below), not to an `Arc<Mutex<…>>` that every task locks.

## Actors

Long-lived state with its own work, such as the relay's connections or a group's mailbox, is an actor, as in Alice Ryhl's [Actors with Tokio](https://ryhl.io/blog/actors-with-tokio/):

- **The actor is a task that owns its state** and a receiver, and handles one message at a time in a loop. Nothing else can touch the state, so it needs no lock.
- **The handle is the only way in:** a small `Clone` struct holding the sender, with one `async` method per message. A message that needs an answer carries a `tokio::sync::oneshot::Sender` for it.
- **Channels are bounded**, so a slow actor slows its senders instead of letting memory grow.
- **It stops when the last handle is dropped:** the receiver gives `None` and the loop ends. The server's shutdown (a `tokio_util::sync::CancellationToken`, or axum's graceful shutdown) is the other way, for actors that must finish their work first.
- **The actor's decisions are its core**: the loop receives a message, calls a pure function on the state and the message, and carries out what it returns. So the actor is tested without starting it.

## Lints and formatting

- **`rustfmt` formats, with its defaults** (100 columns, as oxfmt has for the app), and CI checks it with `cargo fmt --check`.
- **Clippy runs with `pedantic`**, and CI fails on any warning (`cargo clippy --all-targets --locked -- --deny warnings`). The workspace's [`Cargo.toml`](../../Cargo.toml) also turns on a few lints from `restriction`: `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`, `dbg_macro`, `print_stdout` and `print_stderr` (logs go through `tracing`), `allow_attributes` and `allow_attributes_without_reason`, and `undocumented_unsafe_blocks`. Cargo's own lints (Rust 1.100) run too: `unused_dependencies` fails on a dependency no code uses, as knip does for npm.
- **Long numbers are grouped with `_`, as in the TypeScript** (see Formatting and linting in [`docs/guidelines/typescript.md`](typescript.md)): in threes from five digits (`10_000`), hexadecimal in fours (`0x811c_9dc5`), and four digits as they are. Clippy's `unreadable_literal` asks for separators only from six digits and accepts both forms below that, so five digits are left to review; `inconsistent_digit_grouping` catches groups of different lengths.
- **An exception is `#[expect(lint, reason = "…")]` on the item it applies to**, never `#[allow]`: `expect` warns once the exception isn't needed anymore, as oxlint does for a disable that no longer disables anything, and the reason is required.
- **No `unsafe`.** The server's crates forbid it (`unsafe_code = "forbid"`). A crate that needs it, such as one for the browser, allows it where it's needed, and every block gets a `// SAFETY:` comment saying why it's sound, which `undocumented_unsafe_blocks` checks.
- **Doc comments** (`///`) say what the name and the type don't, as in [`docs/guidelines/typescript.md`](typescript.md), and a public function that returns a `Result` says when it fails under `# Errors`, which `pedantic` asks for.

## The supply chain

As strict as [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) is for npm:

- **Exact versions.** Every dependency is written with `=` in `[workspace.dependencies]` (`axum = "=0.8.9"`), and `Cargo.lock` is committed, so the versions that were tested are the ones that build. CI builds with `--locked`, which fails when the lockfile would change.
- **New releases wait a week**, so a broken or compromised one has time to be found and pulled, as pnpm's `minimumReleaseAge` makes npm packages wait. Since Rust 1.100, Cargo does this itself: `registry.global-min-publish-age = "7 days"` in [`.cargo/config.toml`](../../.cargo/config.toml) makes the resolver skip younger versions when it picks one, by the publish time in the crates.io index. A test checks that it's as long as pnpm's wait.
- **The lockfile is checked against the same age.** Cargo keeps a version that's already in `Cargo.lock`, however young (`resolver.incompatible-publish-age`), where pnpm checks its lockfile on every install. So [`scripts/check-crate-age.ts`](../../scripts/check-crate-age.ts) does that half in CI: it reads every crate in `Cargo.lock`, looks up when that version was published, and fails on one younger than Cargo's setting, or one without a publish time. An exception names the exact version and says why, in `[workspace.metadata.release-age]` in [`Cargo.toml`](../../Cargo.toml). Taking a young version on purpose means setting the age to `"0"` for that one `cargo update` (`CARGO_REGISTRY_GLOBAL_MIN_PUBLISH_AGE=0`) and adding its exception. Dependabot proposes updates with the same week's cooldown, so its pull requests pass both.
- **[cargo-deny](https://github.com/EmbarkStudios/cargo-deny) checks the rest** ([`deny.toml`](../../deny.toml)): no crate with a security advisory in the RustSec database, only licenses on the list, crates only from crates.io (no git dependencies, no other registries), and no wildcard versions. An exception that isn't needed any more fails the check too, an ignored advisory no crate has or an allowed license no crate uses, so the lists stay what the tree needs.
- **Build scripts and procedural macros run code at build time**, as install scripts do for npm, and Cargo can't turn them off. So a new dependency's tree is read before it's added: what it pulls in, and which of those have a `build.rs` or are procedural macros. Prefer the standard library and the crates the workspace already has.

## Tests

- **Unit tests sit in the module they test**, in a `#[cfg(test)] mod test` at its end, and test the pure core with input and expected output. What [`docs/guidelines/tests.md`](tests.md) says about what earns a test holds here too.
- **A handler is tested through its router** with `tower::ServiceExt::oneshot`, which sends a request to the service without a socket: status, headers and body, with no network and no port.
- **`unwrap()` and `expect()` are fine in tests**, where a panic is a failed test. The workspace's [`clippy.toml`](../../clippy.toml) allows them there.
- **Deterministic simulation, for code with a network:** [turmoil](https://github.com/tokio-rs/turmoil) (from the Tokio project) runs several hosts in one process, on a simulated network and clock it controls, with a seed, so a run that fails replays exactly. It's chosen over [madsim](https://github.com/madsim-rs/madsim), which replaces Tokio itself and needs patched dependencies, because turmoil works with the real Tokio and only swaps the network types the code uses. It comes in with the first networked actor (the relay and the mailbox); the server's skeleton has nothing for it to simulate yet. As with the merge's simulation in the app, the actors' decisions are pure, so most tests need no simulation at all.
- **Mutation testing** with [cargo-mutants](https://mutants.rs/) works as StrykerJS does for the app (see Mutation testing in [`docs/guidelines/tests.md`](tests.md)): run by hand over the pure core, its survivors read, not counted.
- **A browser test checks what the server does for the app**: that the app reaches the full storage level when the server serves it, with service workers blocked (`pnpm test:server`, see Running it in [`crates/server/README.md`](../../crates/server/README.md)).
