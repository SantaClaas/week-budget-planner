# Week Budget Planner

A drag-and-drop week planner. Activities get a weekly or daily hour budget, the user puts blocks of them on a Monday–Sunday week, then moves and resizes the blocks, and each activity shows live how many hours are still left to place.

## Where things are

- `docs/SPEC.md`: the behavior spec, including the **glossary** of terms. Read it before building anything.
- `docs/CODING-GUIDELINES.md`: how code is named, split into modules and styled. Read it before writing code.
- `docs/LOADING.md`: what the page loads, in which order and why. When you add anything the page loads (a script, chunk, font, image, polyfill), give it a tier there and check the build output.
- **Design canvas: https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk** (private, ask the user for access). It is the visual reference for every screen and state, in Material 3 Expressive. Its tokens are extracted to `docs/design/m3-tokens.css`.
- `prototype/week-budget-planner.html`: a working single-file prototype in vanilla JS. It's the reference for behavior, except where the spec's "Changes from the prototype" says otherwise. It is no longer the reference for the look, and its copy still says "tile" and "arm". It was built as a claude.ai artifact, so its `window.claude.use("db")` / `use("user")` code is platform-specific and won't run here. Its storage is replaced by in-browser SQLite (see Persistence in the spec).
- **Reference project: [SantaClaas/flashcut](https://github.com/SantaClaas/flashcut)** (same author, Solid 2.0, public). Clone it and reuse its storage layer: `src/db/client.ts` (leader election plus export, import and wipe), `src/lib/broadcast-service.ts`, `src/lib/broadcast.ts`, `src/lib/db-file.ts`, `src/lib/download.ts`, the COOP/COEP headers in `vite.config.ts`, and `public/_headers`. Flashcut already solves the hard part of multiple tabs: Web Locks leader election plus a typed RPC proxy over BroadcastChannel. Start from it, and change it where that makes sense here (this project's names and module layout, for example).
- `icons/icons.json`, `scripts/build-iconset.ts` and `src/icons/iconset.svg`: the Material Symbols iconset. To add an icon, add it to the manifest and run `pnpm icons:fetch`. Use the official SVGs only, never the icon font. See the spec's Design section.
- `docs/design/m3-shapes.css` and `scripts/build-shapes.ts` (`pnpm shapes`): Google's Material 3 Expressive shapes as CSS `shape()` values, generated from Google's own Kotlin sources. Use them for activity shapes; never redraw them.
- `examples/example-week.json`: example plan data in the stored format.
- `docs/*.png`: screenshots of the prototype (old look).

## Stack

- **SolidJS 2.0**, which is still a release candidate as of October 2026. Pin exact versions and don't use ranges, since breaking changes between RCs are possible:
  - `solid-js@2.0.0-rc.14`
  - `@solidjs/web@2.0.0-rc.14` (DOM rendering and `render` live here in 2.0, not in `solid-js/web`)
  - `@solidjs/vite-plugin@3.0.0-next.47` (the 2.0 replacement for `vite-plugin-solid`)
  - `vite@8`, TypeScript, strict mode
  - Storage: `@tursodatabase/database-wasm` (SQLite in OPFS, as in flashcut) with `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4` (pinned, since the 1.0 line is also an RC). Schema in `src/db/schema.ts`. Generate migrations with drizzle-kit into `drizzle/` and commit them. The details, including the tab-leader proxy and the required **database export/import**, are in the spec's Persistence section.
  - Use pnpm, like flashcut (`pnpm dlx` or `pnpx` instead of `npx`). pnpm 12, pinned with its hash in `packageManager`. `pnpm-workspace.yaml` is strict about the supply chain: a version must be a week old before it installs (like Dependabot's cooldown), trust can't drop between releases, only listed packages run install scripts, and versions are saved exact. Each exception there names the exact version and says why.
  - Formatting and linting: `oxfmt` (`pnpm format`, `pnpm format:check`) and `oxlint` with type-aware rules through `oxlint-tsgolint` (`pnpm lint`), all pinned. CI runs both. Run them, and `pnpm typecheck`, before committing.
  - Unused code and dependencies: knip (`pnpm knip`, config in `knip.jsonc`). Spelling: [typos](https://github.com/crate-ci/typos) (`typos`, config in `typos.toml`; install it with `brew install typos-cli`, `cargo install typos-cli` or `pip install typos`). CI runs both.
  - Editors: `.vscode/` and `.zed/` set up the Oxc extension (oxfmt on save, oxlint fixes) and the Typos extension; VS Code also recommends Knip's. Zed can't suggest extensions from a project, so install Oxc and Typos there yourself.
  - **Strict, with explained exceptions.** The lint and TypeScript are both strict (see Formatting and linting in `docs/CODING-GUIDELINES.md`). **No type assertions:** `as`, `<T>` and `!` are lint errors, `as const` is fine. Check values with type guards, sanitizers or parsers instead. Where a rule really doesn't apply, disable it on that line with a reason: `// oxlint-disable-next-line rule -- why`, or `// @ts-expect-error -- why`. The lint fails without the reason. Never `@ts-ignore`.
  - Node: the latest release (26), set in `.node-version`, which CI reads too. Node runs our TypeScript itself through its type stripping, with no compile step: the build scripts in `scripts/`, the Vite and Vitest configs (`--configLoader native`) and the oxlint plugin. So that code uses only erasable syntax and imports other files with their `.ts` extension (see Formatting and linting in `docs/CODING-GUIDELINES.md`).
  - Browser tests: Playwright, in `e2e/` (`pnpm test:browser` builds and runs them), for the paths where a failure would cost the user their plan. CI installs the matching Chromium. In a cloud container, use the preinstalled one: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:browser`.
  - Hosting: GitHub Pages, with a service worker that adds the cross-origin isolation headers, and progressive enhancement down to private windows. See Hosting and Progressive enhancement in the spec.
- **Material 3 Expressive, built with plain CSS.** Use the tokens in `docs/design/m3-tokens.css` and the spec's Design section, and build the components (navigation bar, bottom sheet, snackbar, floating toolbar and so on) yourself, without a component library.
- **CSS layers:** `@layer reset, base, theme, components, utilities;`, as the spec's Design section describes. No global `*` reset.
- **Avoid px.** Sizes are relative so text size settings work (WCAG 1.4.4). Convert Google's dp and sp to rem by dividing by 16 (16dp = 1rem), use `em` for breakpoints, and keep px only for 1–2px hairlines such as borders and outlines. Never set a font size on `:root` or `html`. See "Text size and zoom" in the spec.
- **No HTML from strings.** A Content Security Policy with Trusted Types only lets the build's own templates be written as HTML (see Security in the spec). Show user text as text (JSX children, `textContent`), never through `innerHTML` or `insertAdjacentHTML`.
- **Browser support:** a cutting-edge app for up-to-date browsers. Baseline Newly available features are fine. Use a fallback where one exists and is cheap, and list every feature without one in the spec's Browser support section.
- **Expressive on purpose.** The app should feel playful and personal, with some whimsy: activity shapes, lively color, springy motion. Lean expressive wherever Google's guidance allows, but never at the cost of clutter, legibility or accessibility. See "Expressiveness" in the spec's Design section.
- **Google is the only source for Material Design.** That means m3.material.io, the official [Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit) in Figma, and Google's own code (androidx `material3/tokens`, material-color-utilities, Material Symbols, Google Fonts). Never take Material values or patterns from memory, third-party libraries (MUI, Vuetify, Flutter packages and the like), blog posts or other unofficial write-ups. **Only the user can approve a deviation** from Google's guidance. Ask before deviating, and record each approved deviation in the spec's Design section. The Figma kit needs a signed-in account, and m3.material.io may not be reachable from a cloud container, so ask the user if you need either.

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

This project uses Google Chrome's [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) skill, installed into the repository: `.agents/skills/modern-web-guidance/` (with a symlink for Claude Code in `.claude/skills/`) and pinned in `skills-lock.json`. It was installed with `pnpx modern-web-guidance@latest install`; update it with `pnpx modern-web-guidance@latest update` and commit the result.

**Use the `modern-web-guidance` skill before implementing any UI, CSS or client-side feature**, such as the grid layout, the sticky header and gutter, pointer-event dragging, the snackbar, menu and placing toolbar (consider the Popover API), the bottom sheet and dialogs (`<dialog>`), the activity forms and validation (`:user-invalid`), focus handling, dark mode tokens, spring-like easing with `linear()`, and View Transitions for block changes. Prefer the native platform pattern it returns over a library or a hand-rolled version. The skill runs its searches through the `modern-web-guidance` CLI. Use pnpm: `pnpx modern-web-guidance@latest search "<what you want to do>"`, then `retrieve "<id>"`.

## Suggested shape (adjust as needed)

- Plan state in one store, with pure functions for budget math, lanes, snapping and the first free slot. These are easy to unit test, so test them with Vitest.
- Components: `ActivityList` (activities and their forms), `WeekGrid` (header, gutter, day columns), `Block`, `AddBlock` (the menu or bottom sheet on an empty slot), `PlacingToolbar`, `Snackbar`, `SettingsPage`, and `NavigationBar` for phones.
- Use pointer events (not HTML5 drag and drop) so mouse, pen and touch share one code path. Use a single drag controller with window listeners, and update during drags inside `requestAnimationFrame`.
- Repository functions in `src/db/` that take the Drizzle database as a parameter, so tests can pass a Node-backed instance (flashcut's pattern).

## Working agreements

- **The consumer's needs come first.** Start from what the user (or, for an API, the program using it) needs, derive the interface from that, and the types and structure from the interface. Those needs outrank every other guideline. See "The consumer's needs come first" in `docs/CODING-GUIDELINES.md`.
- Match the prototype's interactions exactly, including the keyboard and touch paths, except for the spec's "Changes from the prototype" or other changes the user asks for.
- **Ask before the browser asks.** Never trigger a browser permission prompt (persistent storage, location, camera and so on) without the app first explaining why in its own UI, with a button that makes the request. See Browser permissions in the spec.
- Use the spec's glossary for every name, in UI copy and in code: "block" (never "tile"), "slot", "length", "placing" (never "armed"), "left to place", "over budget". Keep the copy plain. If you need a new term, add it to the glossary first.
- Follow `docs/CODING-GUIDELINES.md` for names, modules, coupling, refactoring and CSS: no abbreviations, functions start with a verb, modules named for what they are (no `lib` or `utils`), as few exports as possible, dependencies one way, and wait for about three repeats before pulling something out.
- Keep the browser tests in `e2e/` passing, and add one when a new path could lose the user's data. Before calling the port done, also test it in a browser by hand: drag from the Activities list, move, resize from both edges, placing by tap on touch, adding a block from an empty slot (menu on desktop, bottom sheet on a phone), the phone navigation bar, undo, a reload that keeps state, two tabs open at once, a database export followed by an import of that file, both color themes, including the theme setting, and a private window or a browser with service workers blocked (the limited storage level).
