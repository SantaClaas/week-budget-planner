---
paths:
  - "src/**/*.tsx"
  - "src/**/*.ts"
---

# Solid 2.0

The app is built with SolidJS 2.0, a release candidate, pinned to exact versions (see `CLAUDE.md`). This adds to `docs/guidelines/principles.md` and `docs/guidelines/typescript.md`.

## Read the official sources first

Solid 2.0 is not 1.x. Effects, batching, stores, async data, control flow and the package layout all changed, and most training data and online examples are 1.x. **Don't write Solid code from memory.** Before writing or reviewing reactive code, read the official material for the installed version:

1. **`node_modules/solid-js/CHEATSHEET.md`**: the official one-page 2.0 reference, shipped inside the package for code generators. The bottom lists the 1.x patterns that changed. Read it at the start of every session that touches Solid code.
2. **`node_modules/solid-js/skills/`**: official agent skills shipped with the package (for example `reactivity-diagnostics`). Use them when debugging reactivity.
3. **The migration guide from 1.x to 2.0:** [`documentation/solid-2.0/MIGRATION.md`](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md) on the `next` branch of `solidjs/solid`. The per-topic RFCs sit beside it in [`documentation/solid-2.0/`](https://github.com/solidjs/solid/tree/next/documentation/solid-2.0) (reactivity and batching, signals and ownership, control flow, stores, async data, actions, DOM, TypeScript and JSX).
4. **Changelogs between RCs:** [`packages/solid/CHANGELOG.md`](https://github.com/solidjs/solid/blob/next/packages/solid/CHANGELOG.md), [`packages/web/CHANGELOG.md`](https://github.com/solidjs/solid/blob/next/packages/web/CHANGELOG.md) and [`packages/signals/CHANGELOG.md`](https://github.com/solidjs/solid/blob/next/packages/signals/CHANGELOG.md) on `next`. Check them whenever you bump an RC version.
5. **[docs.solidjs.com](https://docs.solidjs.com)**: the general documentation, which may still describe 1.x in places. If it disagrees with the cheatsheet or the migration guide, those two win for 2.0.
6. **Type definitions** in `node_modules/solid-js` and `node_modules/@solidjs/signals`: the final word on signatures.

Flashcut's `CLAUDE.md` has project-tested notes from `beta.17`: `<Loading>`/`<Errored>`, async `createMemo` with `refresh()`, `onSettled`, split `createEffect`, microtask batching, `render` from `@solidjs/web`, and a non-keyed `<Show>` stale-read bug. Treat them as hints and confirm each one against the sources above, since this project is on `rc.14`.

## Shape

- Plan state in one store, with pure functions for budget math, lanes, snapping and the first free slot. These are easy to unit test, so test them with Vitest.
- Components: `ActivityList` (activities and their forms), `WeekGrid` (header, gutter, day columns), `Block`, `AddBlock` (the menu or bottom sheet on an empty slot), `PlacingToolbar`, `Snackbar`, `SettingsPage`, and `NavigationBar` for phones. A suggestion, to adjust as the code asks.
- Use pointer events (not HTML5 drag and drop) so mouse, pen and touch share one code path. Use a single drag controller with window listeners, and update during drags inside `requestAnimationFrame`.
- **No HTML from strings.** A Content Security Policy with Trusted Types only lets the build's own templates be written as HTML (see `docs/spec/security.md`). Show user text as text (JSX children, `textContent`), never through `innerHTML` or `insertAdjacentHTML`.
