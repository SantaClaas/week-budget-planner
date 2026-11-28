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

- **One Cargo workspace at the repository's root**, with each crate in [`crates/`](../../crates/), named for what it is: [`crates/server/`](../../crates/server/) and the browser's side of the transport, [`crates/transport/`](../../crates/transport/), today, and the protocol beside them later. `crates/` is a folder name Rust people and tools expect, like `docs/` (see Modules in [`principles.md`](principles.md)).
- **The toolchain is pinned** in [`rust-toolchain.toml`](../../rust-toolchain.toml), with `rustfmt` and `clippy`, so everyone and CI build with the same compiler, as [`.node-version`](../../.node-version) does for Node. A new Rust release is taken by changing that file, a week after the release, like any dependency.
- **What every crate shares is set once in the workspace's [`Cargo.toml`](../../Cargo.toml):** the edition, the lints and the dependencies' versions (`[workspace.dependencies]`). A crate takes them with `workspace = true`.
- **The app's build doesn't depend on Rust.** `pnpm build` and the app's checks run without a Rust toolchain, and the Rust checks run as jobs of their own.

## Names

- **Rust's own conventions come first**, since they're the platform's names (see Names in [`principles.md`](principles.md)): `snake_case` for functions, variables and modules, `UpperCamelCase` for types and traits, `SCREAMING_SNAKE_CASE` for constants. The [API guidelines](https://rust-lang.github.io/api-guidelines/naming.html) are part of that: a constructor is `new`, a getter is named for what it gets without `get_` (`base()`, `len()`), and conversions are `as_`, `to_` and `into_`. These are the places a function doesn't start with a verb.
- **Everything else from the principles holds:** no abbreviations (`request`, not `req`; `response`, not `res`; `address`, not `addr`), functions start with a verb, and booleans are questions that start with `is_`. A library's own abbreviations stay at its edge (`tokio::net::TcpListener::local_addr`).
- **Modules are named in the singular** and their items drop the module's noun: `header::build`, not `header::build_headers`.
- **No binding is named `kind`,** as in the TypeScript (see [Discriminated unions](typescript.md#discriminated-unions) in [`docs/guidelines/typescript.md`](typescript.md)): Clippy's `disallowed-names` in [`clippy.toml`](../../clippy.toml) refuses it. It doesn't check fields, so those are left to review. A library's own, like `std::io::Error::kind()`, is its edge.
- **A keyword is no reason to pick another name.** Where the right name is a keyword, write it as a raw identifier: `r#type`, not `kind` or `type_`. The transport's `Failure` has a `r#type` field, which JavaScript reads as `failure.type` through wasm-bindgen, the name [`docs/guidelines/typescript.md`](typescript.md) gives the field that tells values apart.

## Modules and visibility

- **A module is a file; when it grows, it gets a folder of the same name** beside it, with its submodules inside: `asset.rs` and `asset/encoding.rs`. No `mod.rs`, so a module's file is always named for it, the way `broadcast.ts` becomes `broadcast/index.ts` in the app.
- **Visibility is as narrow as it can be.** Items are private by default; `pub(crate)` for what other modules of the crate use; `pub` only for the crate's own interface. Rust enforces what TypeScript can only ask for (see Coupling in [`principles.md`](principles.md)), so use it.
- **A module builds its own router and exports only that**, as Vertical first in [`principles.md`](principles.md) describes: handlers stay private, and `main` merges a few routers instead of listing every handler.
- **Declare before use** holds as in the principles, although Rust doesn't need it: types, constants and helpers first, the module's entry point last, and its `#[cfg(test)] mod test` at the very end.

## Types and dispatch

Follow [The rule of least power](principles.md#the-rule-of-least-power) in [`docs/guidelines/principles.md`](principles.md) when choosing how to represent variation: reach for the narrowest form the problem needs, in order.

- **Start with a concrete type.** When there's only one implementation today, write that type directly instead of introducing a trait or an enum for a second one that doesn't exist yet (see [Refactoring](principles.md#refactoring) in [`docs/guidelines/principles.md`](principles.md)). Don't add a `dyn Trait` just to mock a dependency in tests: the pure core takes plain values and functions instead (below), and networked edges use `turmoil`.
- **Use an `enum` for a closed set of cases.** When the workspace owns all the variants, model them as an `enum` rather than a trait object — even when values of different kinds live in the same struct, channel or `Vec`, or are chosen at runtime. Every case stays in one place, `match` checks exhaustiveness at compile time, `Clone`/`Debug`/`PartialEq` stay trivial, and `async` methods don't hit dyn-compatibility limits. When one variant is much larger than the rest, box that variant (`Box<…>`) rather than switching to `dyn Trait`; `pedantic`'s `large_enum_variant` flags it. Prefer a plain `match` over adding a procedural-macro crate such as `enum_dispatch` (see [The supply chain](#the-supply-chain)).
- **Use generics (`impl Trait` or `<T: Trait>`) for an open set chosen statically.** Traits give open extensibility without dynamic dispatch whenever each call site or struct instance fixes one concrete type (for example, a stream or a socket swapped between Tokio and `turmoil`). Generics inline across the call boundary with no vtable overhead and work with `async fn` and associated types, at the cost of monomorphization (compile time and binary size) and the type parameter appearing in signatures.
- **Use `dyn Trait` only when type erasure earns its keep:**
  - **At an outside API that requires it.** The relay's [`crates/server/src/relay/admission.rs`](../../crates/server/src/relay/admission.rs) returns `Arc<dyn DynAccessControl>` because `iroh-relay` expects it, while the policy inside stays a closed enum (`Admitted`).
  - **To mix or swap an open set at runtime,** where an enum can't name every implementation (middleware stacks, callbacks, erased or recursive futures).
  - **To bound monomorphization or signature noise,** when carrying a generic parameter through surrounding structs would complicate the code or bloat binary size (notably in WASM crates such as [`crates/transport/`](../../crates/transport/)) more than a vtable call costs.

## Errors

- **What can fail returns a `Result`**, and its error says what went wrong as a value: an enum per module, made with [`thiserror`](https://docs.rs/thiserror), whose variants are the outcomes a caller can act on. No `Box<dyn Error>` and no `anyhow` in a library crate; a binary's `main` may report one error type of its own.
- **At the edge to JavaScript, errors become one type.** wasm-bindgen can't export an enum with data, so what an exported function throws is one class with a `type` field (the transport's `Failure` and its `Type`), and the page tells failures apart by that field. Inside, errors stay enums per module, and the exported functions convert them with `From` impls, so `?` does it at the edge and each impl decides the `type` in one place. A crate that is all edge, like [`crates/transport/`](../../crates/transport/) today, where every function is exported and is a call or two into iroh, uses the one type throughout, and each function's `# Errors` names the types it can give, since its signature can't. Rust with logic of its own behind the edge, such as the sync protocol shared by the server and the browser, gets its own enums.
- **A panic is for a bug**, as a throw is for what nobody planned for in [`docs/guidelines/typescript.md`](typescript.md). `unwrap()`, `expect()`, `panic!`, `todo!` and `unimplemented!` are lint errors outside tests. Where one is right, because the program can't go on and the reason is known, the line says why with `#[expect(clippy::expect_used, reason = "…")]` and `expect()` says what was expected.
- **`?` takes the place of one operation per `try`**: each fallible call is its own `?`, and a `map_err` turns the error into the module's own where the meaning changes.
- **An error that only changes type is a `map_err`, not a `let … else`.** `let Ok(value) = step else { return Err(…) };` throws the error away, builds another, and makes a reader look for a second branch that isn't there; `step.map_err(…)?` says what happens. `let … else` is for an `Option`, and for a branch that does more than give back an error, like the relay's answer to a request without a protocol it speaks. Clippy has no lint against it, and its `manual_let_else` would suggest exactly that form for a `match` whose error branch ignores the error, so [`clippy.toml`](../../clippy.toml) sets it to leave matches alone (`matches-for-let-else = "Never"`), and a `let … else` written by hand is left to review.
- **An exported function borrows what it only reads**, `&str` and `&[u8]` rather than `String` and `Vec<u8>`, in an `async fn` too: wasm-bindgen gives a shared reference there to the future, which owns the copy JavaScript passed in until it finishes (a "long reference" in its macro). A fixed array like `[u8; 32]` doesn't cross the boundary at all.
- **Parse with the type's own `FromStr` or `TryFrom`** (`text.parse()`, `<[u8; 32]>::try_from(bytes)`) and map its error. A parser of our own is only for a format no type reads, like the node key's file.
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
- **The lockfile is checked against the same age.** Cargo keeps a version that's already in `Cargo.lock`, however young (`resolver.incompatible-publish-age`), where pnpm checks its lockfile on every install. So [`scripts/check-crate-age.ts`](../../scripts/check-crate-age.ts) does that half in CI: it reads every crate in `Cargo.lock`, looks up when that version was published, and fails on one younger than Cargo's setting, or one without a publish time. An exception is a table in `[workspace.metadata.release-age]` in [`Cargo.toml`](../../Cargo.toml) with the crate's `name`, its exact `version`, a `reason`, who agreed to it (`approved-by`) and when (`approved-on`), which the script requires, as cargo-deny requires a reason for an ignored advisory. An optional `until` is the last day it holds. The check fails on an exception past its `until`, and on one that isn't needed any more, because its version is old enough by now or no longer in the lockfile, so the list can't keep exceptions nobody needs. The dates are `"YYYY-MM-DD"` strings: `cargo metadata` hands a TOML date to tools in a private form of its own. Cargo leaves `[workspace.metadata]` to tools and ignores it; the field inside is this project's, named after pnpm's `minimumReleaseAgeExclude`. Taking a young version on purpose means setting the age to `"0"` for that one `cargo update` (`CARGO_REGISTRY_GLOBAL_MIN_PUBLISH_AGE=0`) and adding its exception. Dependabot proposes updates with the same week's cooldown, so its pull requests pass both.
- **[cargo-deny](https://github.com/EmbarkStudios/cargo-deny) checks the rest** ([`deny.toml`](../../deny.toml)): no crate with a security advisory in the RustSec database, only licenses on the list, crates only from crates.io (no git dependencies, no other registries), and no wildcard versions. An exception that isn't needed any more fails the check too, an ignored advisory no crate has or an allowed license no crate uses, so the lists stay what the tree needs.
- **Build scripts and procedural macros run code at build time**, as install scripts do for npm, and Cargo can't turn them off. So a new dependency's tree is read before it's added: what it pulls in, and which of those have a `build.rs` or are procedural macros. Prefer the standard library and the crates the workspace already has.

## Tests

- **Unit tests sit in the module they test**, in a `#[cfg(test)] mod test` at its end, and test the pure core with input and expected output. What [`docs/guidelines/tests.md`](tests.md) says about what earns a test holds here too.
- **A handler is tested through its router** with `tower::ServiceExt::oneshot`, which sends a request to the service without a socket: status, headers and body, with no network and no port.
- **`unwrap()` and `expect()` are fine in tests**, where a panic is a failed test. The workspace's [`clippy.toml`](../../clippy.toml) allows them there.
- **Deterministic simulation, for code with a network:** [turmoil](https://github.com/tokio-rs/turmoil) (from the Tokio project) runs several hosts in one process, on a simulated network and clock it controls, with a seed, so a run that fails replays exactly. It's chosen over [madsim](https://github.com/madsim-rs/madsim), which replaces Tokio itself and needs patched dependencies, because turmoil works with the real Tokio and only swaps the network types the code uses. It comes in with the first networked actor (the relay and the mailbox); the server's skeleton has nothing for it to simulate yet. As with the merge's simulation in the app, the actors' decisions are pure, so most tests need no simulation at all.
- **Mutation testing** with [cargo-mutants](https://mutants.rs/) works as StrykerJS does for the app (see Mutation testing in [`docs/guidelines/tests.md`](tests.md)): run by hand over the pure core, its survivors read, not counted.
- **A browser test checks what the server does for the app**: that the app reaches the full storage level when the server serves it, with service workers blocked (`pnpm test:server`, see Running it in [`crates/server/README.md`](../../crates/server/README.md)).
