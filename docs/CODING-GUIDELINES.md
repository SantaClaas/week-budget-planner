# Coding guidelines

How code in this project is named, split, styled and checked. The guidelines live in [`docs/guidelines/`](guidelines/), one file per kind of code, so that each context only needs the parts that apply to it.

| File | Applies to | What's in it |
| --- | --- | --- |
| [`principles.md`](guidelines/principles.md) | all code, always | the consumer's needs first, the rule of least power, names, pure functions, early returns, one operation per `try`, modules (one noun each, named in the singular) and coupling, refactoring, where rules are enforced, linking files and drawing diagrams in the docs |
| [`html.md`](guidelines/html.md) | `.tsx`, `.html` | HTML for the document and CSS for the look, the CSS-off test, the first rule of ARIA, no elements for styling, radio groups that look like buttons, short names with descriptions, classes for what, `data-` attributes for how and native or ARIA attributes for state, boolean attributes, `display: contents` |
| [`typescript.md`](guidelines/typescript.md) | `.ts`, `.tsx`, `.js` | function, boolean and storage key names, branded types, cleanup with `using`, iterator helpers instead of array chains, formatting and linting, no type assertions, explained exceptions |
| [`css.md`](guidelines/css.md) | `.css`, and styles set from TypeScript | cascade layers, selectors, rem instead of px, intrinsic sizing, logical properties, forced colors, nesting |
| [`solid.md`](guidelines/solid.md) | [`src/`](../src/) | Solid 2.0's official sources, the app's shape, no HTML from strings |
| [`database.md`](guidelines/database.md) | [`src/database/`](../src/database/), [`src/storage/`](../src/storage/), [`drizzle/`](../drizzle/) | libraries, schema and migrations, repository functions, the storage layer from flashcut |
| [`tests.md`](guidelines/tests.md) | `*.test.ts`, [`e2e/`](../e2e/) | what earns a test, unit and browser tests, keyboard tests, mutation testing, automatic accessibility checks, screen reader checks (Orca in a cloud container) |
| [`rust.md`](guidelines/rust.md) | `.rs`, [`crates/`](../crates/), the Cargo files | the workspace and the pinned toolchain, Rust's names, modules and visibility, enums and generics over `dyn Trait`, errors and panics, the pure core in async code, actors, Clippy and explained exceptions, the supply chain (exact versions, a week's wait, cargo-deny), tests and deterministic simulation |
| [`workflows.md`](guidelines/workflows.md) | [`.github/`](../.github/) | hash-pinned actions, workflow linting, least privilege, Dependabot |

Start with the principles; they hold everywhere. Before working on a kind of code, read its file too. Coding agents load them by themselves: [`.claude/rules/`](../.claude/rules/) links to each file for Claude Code (using each file's `paths` front matter, or always-on when there is none), and [`.agents/rules/`](../.agents/rules/) mirrors the same triggers for Antigravity.

**These are idealistic documents.** They describe the code we strive for, not code we expect to reach perfectly, and if one guideline turns out wrong, the others still apply (see the start of `principles.md`).
