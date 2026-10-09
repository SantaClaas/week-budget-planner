# Week Budget Planner

A drag-and-drop week planner. Activities get a weekly or daily hour budget, the user puts blocks of them on a Monday–Sunday week, then moves and resizes the blocks, and each activity shows live how many hours are still left to place.

## Where things are

- `docs/SPEC.md`: the behavior spec, including the **glossary** of terms. Read it before building anything.
- **Design canvas: https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk** (private, ask the user for access). It is the visual reference for every screen and state, in Material 3 Expressive. Its tokens are extracted to `docs/design/m3-tokens.css`.
- `prototype/week-budget-planner.html`: a working single-file prototype in vanilla JS. It's the reference for behavior, except where the spec's "Changes from the prototype" says otherwise. It is no longer the reference for the look, and its copy still says "tile" and "arm". It was built as a claude.ai artifact, so its `window.claude.use("db")` / `use("user")` code is platform-specific and won't run here. Its storage is replaced by in-browser SQLite (see Persistence in the spec).
- **Reference project: [SantaClaas/flashcut](https://github.com/SantaClaas/flashcut)** (same author, Solid 2.0, public). Clone it and reuse its storage layer: `src/db/client.ts` (leader election plus export, import and wipe), `src/lib/broadcast-service.ts`, `src/lib/broadcast.ts`, `src/lib/db-file.ts`, `src/lib/download.ts`, the COOP/COEP headers in `vite.config.ts`, and `public/_headers`. Flashcut already solves the hard part of multiple tabs: Web Locks leader election plus a typed RPC proxy over BroadcastChannel. Reuse it as is.
- `examples/example-week.json`: example plan data in the stored format.
- `docs/*.png`: screenshots of the prototype (old look).

## Stack

- **SolidJS 2.0**, which is still a release candidate as of October 2026. Pin exact versions and don't use ranges, since breaking changes between RCs are possible:
  - `solid-js@2.0.0-rc.14`
  - `@solidjs/web@2.0.0-rc.14` (DOM rendering and `render` live here in 2.0, not in `solid-js/web`)
  - `@solidjs/vite-plugin@3.0.0-next.47` (the 2.0 replacement for `vite-plugin-solid`)
  - `vite@8`, TypeScript, strict mode
  - Storage: `@tursodatabase/database-wasm` (SQLite in OPFS, as in flashcut) with `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4` (pinned, since the 1.0 line is also an RC). Schema in `src/db/schema.ts`. Generate migrations with drizzle-kit into `drizzle/` and commit them. The details, including the tab-leader proxy and the required **database export/import**, are in the spec's Persistence section.
  - Use pnpm, like flashcut (`pnpm dlx` instead of `npx`).
- **Material 3 Expressive, built with plain CSS.** Use the tokens in `docs/design/m3-tokens.css` and the spec's Design section. Don't use a Material component library such as `@material/web`, Material Components for the Web or MUI. They look similar but are not M3 Expressive, so build the components (navigation bar, bottom sheet, snackbar, floating toolbar and so on) yourself. Take token values from Google's own sources (androidx `material3/tokens`, material-color-utilities), never from memory. The official component reference is the [Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit) in Figma. It needs a signed-in Figma account, so ask the user if you need it.

## Solid 2.0: read the official sources first

Solid 2.0 is not 1.x. Effects, batching, stores, async data, control flow and the package layout all changed, and most training data and online examples are 1.x. **Don't write Solid code from memory.** Before writing or reviewing reactive code, read the official material for the installed version:

1. **`node_modules/solid-js/CHEATSHEET.md`**: the official one-page 2.0 reference, shipped inside the package for code generators. The bottom lists the 1.x patterns that changed. Read it at the start of every session that touches Solid code.
2. **`node_modules/solid-js/skills/`**: official agent skills shipped with the package (for example `reactivity-diagnostics`). Use them when debugging reactivity.
3. **The migration guide from 1.x to 2.0:** [`documentation/solid-2.0/MIGRATION.md`](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md) on the `next` branch of `solidjs/solid`. The per-topic RFCs sit beside it in [`documentation/solid-2.0/`](https://github.com/solidjs/solid/tree/next/documentation/solid-2.0) (reactivity and batching, signals and ownership, control flow, stores, async data, actions, DOM, TypeScript and JSX).
4. **Changelogs between RCs:** [`packages/solid/CHANGELOG.md`](https://github.com/solidjs/solid/blob/next/packages/solid/CHANGELOG.md), [`packages/web/CHANGELOG.md`](https://github.com/solidjs/solid/blob/next/packages/web/CHANGELOG.md) and [`packages/signals/CHANGELOG.md`](https://github.com/solidjs/solid/blob/next/packages/signals/CHANGELOG.md) on `next`. Check them whenever you bump an RC version.
5. **[docs.solidjs.com](https://docs.solidjs.com)**: the general documentation, which may still describe 1.x in places. If it disagrees with the cheatsheet or the migration guide, those two win for 2.0.
6. **Type definitions** in `node_modules/solid-js` and `node_modules/@solidjs/signals`: the final word on signatures.

Flashcut's `CLAUDE.md` has project-tested notes from `beta.17`: `<Loading>`/`<Errored>`, async `createMemo` with `refresh()`, `onSettled`, split `createEffect`, microtask batching, `render` from `@solidjs/web`, and a non-keyed `<Show>` stale-read bug. Treat them as hints and confirm each one against the sources above, since this project is on `rc.14`.

## Modern Web Guidance (required)

This project uses Google Chrome's [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) plugin. `.claude/settings.json` registers its marketplace and enables `modern-web-guidance@googlechrome`, so Claude Code offers to install it when the folder is trusted. If it isn't installed, run:

```
/plugin marketplace add GoogleChrome/modern-web-guidance
/plugin install modern-web-guidance@googlechrome
/reload-plugins
```

**Use the `modern-web-guidance` skill before implementing any UI, CSS or client-side feature**, such as the grid layout, the sticky header and gutter, pointer-event dragging, the snackbar, menu and placing toolbar (consider the Popover API), the bottom sheet and dialogs (`<dialog>`), the activity forms and validation (`:user-invalid`), focus handling, dark mode tokens, spring-like easing with `linear()`, and View Transitions for block changes. Prefer the native platform pattern it returns over a library or a hand-rolled version. If the skill isn't available, the same guides can be searched with `npx -y modern-web-guidance@latest search "<what you want to do>"` and then `retrieve "<id>"`.

## Suggested shape (adjust as needed)

- Plan state in one store, with pure functions for budget math, lanes, snapping and the first free slot. These are easy to unit test, so test them with Vitest.
- Components: `ActivityList` (activities and their forms), `WeekGrid` (header, gutter, day columns), `Block`, `AddBlock` (the menu or bottom sheet on an empty slot), `PlacingToolbar`, `Snackbar`, `SettingsPage`, and `NavigationBar` for phones.
- Use pointer events (not HTML5 drag and drop) so mouse, pen and touch share one code path. Use a single drag controller with window listeners, and update during drags inside `requestAnimationFrame`.
- Repository functions in `src/db/` that take the Drizzle database as a parameter, so tests can pass a Node-backed instance (flashcut's pattern).

## Working agreements

- Match the prototype's interactions exactly, including the keyboard and touch paths, except for the spec's "Changes from the prototype" or other changes the user asks for.
- Use the spec's glossary for every name, in UI copy and in code: "block" (never "tile"), "slot", "length", "placing" (never "armed"), "left to place", "over budget". Keep the copy plain. If you need a new term, add it to the glossary first.
- Before calling the port done, test it in a browser: drag from the Activities list, move, resize from both edges, placing by tap on touch, adding a block from an empty slot (menu on desktop, bottom sheet on a phone), the phone navigation bar, undo, a reload that keeps state, two tabs open at once, a database export followed by an import of that file, and both color themes, including the theme setting.
