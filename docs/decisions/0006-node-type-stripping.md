# 0006 Node runs our TypeScript through type stripping

**Status:** Accepted, 2026-10-17.

## Context

Besides the app, the project has TypeScript that Node runs: the build scripts in [`scripts/`](../../scripts/), the Vite and Vitest configs, the oxlint plugin and the Playwright tests. Each tool brought its own way of loading TypeScript: Vite and Vitest bundle their configs, and Playwright registers a loader. Node itself can now run TypeScript by removing the types, without a compile step.

## Decision

Everything Node runs is run by Node's own type stripping, on the latest Node release (26, in [`.node-version`](../../.node-version), which CI reads too): the configs with `--configLoader native`, the browser tests with `PW_DISABLE_TS_ESM=1`, and the scripts directly with `node`. All code, the app included, uses only syntax that can be erased and imports other files with their `.ts` extension ([Formatting and linting](../guidelines/typescript.md#formatting-and-linting) in [`docs/guidelines/typescript.md`](../guidelines/typescript.md)).

## Alternatives

- **Each tool's own loader**, as they come by default. Replaced: one way to run TypeScript makes the process simpler and needs fewer dependencies (the project's author, 2026-11-20).
- **A compile step** for the scripts. Not recorded whether it was weighed.

## Consequences

- **No `enum`, `namespace` or parameter properties**, and type-only imports are marked. TypeScript checks both (`erasableSyntaxOnly`, `verbatimModuleSyntax`), and the lint checks the `.ts` extensions, so a file Node couldn't run fails before it runs.
- **The app follows the same rules** although Vite compiles it, so any module could be run by Node as it is. JSX is the exception, which type stripping can't remove.
- **drizzle-kit** still loads its config and the schema through its own loader, since it has no setting to use Node's; it only runs when a migration is generated (see [0003](0003-drizzle-over-a-proxy.md)).
- **Every machine and CI run the Node version in `.node-version`**, so the type stripping behaves the same everywhere.
