# 0001 Solid 2.0 while it's a release candidate

**Status:** Accepted, 2026-10-08, when the prototype was handed over for the port.

## Context

The planner started as a single-file prototype in vanilla JavaScript ([`prototype/week-budget-planner.html`](../../prototype/week-budget-planner.html)), built as a claude.ai artifact, and was to become a real app. The same author's [flashcut](https://github.com/SantaClaas/flashcut) was already built with Solid 2.0, and its storage layer was to be reused here (see [0002](0002-sqlite-in-the-browser.md)). Solid 2.0 was a release candidate, not a stable release.

## Decision

Build the app with SolidJS 2.0, on its release candidates, with every Solid package pinned to an exact version: `solid-js` and `@solidjs/web` at `2.0.0-rc.14` and `@solidjs/vite-plugin` at `3.0.0-next.47` (see [`CLAUDE.md`](../../CLAUDE.md)).

## Alternatives

- **Solid 1.x**, the stable line. Not recorded why it lost to 2.0.
- **Another framework, or none**, such as staying with plain JavaScript like the prototype. Not recorded whether these were weighed.

## Consequences

- **Exact pins, and a changelog read on every bump.** Breaking changes between release candidates are possible, so no version ranges, and the changelogs are read before each update ([Read the official sources first](../guidelines/solid.md#read-the-official-sources-first) in [`docs/guidelines/solid.md`](../guidelines/solid.md)).
- **Most examples and most of what a model learned are 1.x.** Solid code isn't written from memory: the cheatsheet and skills shipped in `solid-js`, the migration guide and the RFCs come first, in that order, and the types have the last word.
- **Flashcut's notes help, with care.** They were tested on an earlier beta, so each one is checked against the sources for the installed version.
