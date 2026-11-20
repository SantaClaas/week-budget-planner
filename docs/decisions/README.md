# Decision records

A decision record keeps a decision that is expensive to reverse: what was decided and when, what was known then, what else was on the table and why it lost, and what follows from it. The spec says how things are now; a record says why, and why not the alternatives, so the same question isn't argued again when a later change brings it up. The form is Michael Nygard's [architecture decision record](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## When to write one

- **For a decision that shapes much of the code or the docs and would be costly to undo**: a framework, a storage engine, a host, a design system, a toolchain. A small choice keeps its reason in the spec or in a comment next to the code, where the reader needs it.
- **When an alternative was weighed and rejected.** A record without alternatives is just a description, and that belongs in the spec.
- **Not where a decision log already exists.** Several parts of the spec keep their own decisions, close to what they decide, and stay there:
  - the user's rules for syncing, in [Decided](../spec/network.md#decided) in [Network](../spec/network.md), [Decided](../spec/merge.md#decided) in [Merging changes](../spec/merge.md) and [Decided](../spec/sync.md#decided) in [The sync protocol](../spec/sync.md), with their "Why not" paragraphs;
  - the approved departures from Google's guidance, in [Deviations](../spec/design.md#deviations) in [Design](../spec/design.md);
  - where the app differs from the prototype on purpose, in [Changes from the prototype](../spec/changes-from-the-prototype.md);
  - the browser features the app uses without a fallback, in [Browser support](../spec/browser-support.md);
  - the exceptions to the supply-chain rules, in [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml).

## How a record is written

- **One file per decision**, numbered in the order they were made: `0007-short-title.md`. The number never changes, so links stay valid.
- **The sections:** Status, Context, Decision, Alternatives, Consequences. Context is what was true and needed when it was decided. Alternatives says what else was weighed and why it lost. Consequences says what follows, the costs included.
- **Only reasons that were given.** Where a record is written after the fact and a reason wasn't written down at the time, it says "Not recorded" instead of guessing, so the gap is visible and the project's author can fill it. A reason filled in later names who gave it and when, as in "(the project's author, 2026-11-20)".
- **A record isn't rewritten.** When a decision changes, a new record says so and replaces the old one, and the old one's status becomes "Replaced by" with a link. A correction of a fact, a link that moved, or a gap filled in by the author may still be edited.
- **The spec links to the record** where the decision shows, instead of repeating the reasons.
- The status is one of: Proposed, Accepted (with the date it was decided), Replaced by a later record, or Dropped.

## Records

| Record | Status |
| --- | --- |
| [0001 Solid 2.0 while it's a release candidate](0001-solid-2-release-candidate.md) | Accepted, 2026-10-08; to be replaced by the move to the release ([SantaClaas/week-budget-planner#122](https://github.com/SantaClaas/week-budget-planner/issues/122)) |
| [0002 SQLite in the browser, with flashcut's storage layer](0002-sqlite-in-the-browser.md) | Accepted, 2026-10-08 |
| [0003 Drizzle 1.0 over a proxy to the leader tab](0003-drizzle-over-a-proxy.md) | Accepted, 2026-10-08 |
| [0004 Material 3 Expressive in plain CSS, from Google's sources only](0004-material-3-in-plain-css.md) | Accepted, 2026-10-15 |
| [0005 GitHub Pages, with a service worker for cross-origin isolation](0005-github-pages-with-a-service-worker.md) | Accepted, 2026-10-15; to be replaced once the server serves the app |
| [0006 Node runs our TypeScript through type stripping](0006-node-type-stripping.md) | Accepted, 2026-10-17 |
