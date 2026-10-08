# Week Budget Planner

A drag-and-drop week planner. Activities get a weekly or daily hour budget, the user places them on a Monday–Sunday grid as tiles, then moves and resizes them, and each activity shows live how many hours are still left to place.

## Where things are

- `docs/SPEC.md`: the behavior spec. Read it before building anything.
- `prototype/week-budget-planner.html`: a working single-file prototype in vanilla JS. It's the reference for behavior, look and copy. It was built as a claude.ai artifact, so its `window.claude.use("db")` / `use("user")` code is platform-specific and won't run here. Use localStorage for now (see Persistence in the spec).
- `examples/example-week.json`: example plan data in the stored format.
- `docs/*.png`: screenshots of the prototype.

## Stack

- **SolidJS 2.0**, which is still a release candidate as of October 2026. Pin exact versions and don't use ranges, since breaking changes between RCs are possible:
  - `solid-js@2.0.0-rc.14`
  - `@solidjs/web@2.0.0-rc.14` (DOM rendering and `render` live here in 2.0, not in `solid-js/web`)
  - `@solidjs/vite-plugin@3.0.0-next.47` (the 2.0 replacement for `vite-plugin-solid`)
  - `vite@8`, TypeScript, strict mode
- Solid 2.0 changes core APIs compared to 1.x, including effects, stores, async and control-flow components. Training data mostly covers 1.x. **Before writing reactive code, check the installed package's type definitions (`node_modules/solid-js`, `node_modules/@solidjs/signals`) and the official 2.0 docs and migration notes.** Don't write from memory of 1.x.
- No UI framework. Use plain CSS with the design tokens from the prototype's `:root` blocks, including the dark theme.

## Modern Web Guidance (required)

This project uses Google Chrome's [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) plugin. `.claude/settings.json` registers its marketplace and enables `modern-web-guidance@googlechrome`, so Claude Code offers to install it when the folder is trusted. If it isn't installed, run:

```
/plugin marketplace add GoogleChrome/modern-web-guidance
/plugin install modern-web-guidance@googlechrome
/reload-plugins
```

**Use the `modern-web-guidance` skill before implementing any UI, CSS or client-side feature**, such as the grid layout, the sticky header and gutter, pointer-event dragging, the toast and dock (consider the Popover API), the activity forms and validation (`:user-invalid`), focus handling, dark mode tokens and `oklch` colors, and View Transitions for tile changes. Prefer the native platform pattern it returns over a library or a hand-rolled version. If the skill isn't available, the same guides can be searched with `npx -y modern-web-guidance@latest search "<what you want to do>"` and then `retrieve "<id>"`.

## Suggested shape (adjust as needed)

- Plan state in one store, with pure functions for budget math, lanes, snapping and the first free slot. These are easy to unit test, so test them with Vitest.
- Components: `Ledger` (activity list and forms), `WeekGrid` (header, gutter, day columns), `Tile`, `Dock` (toast and placing bar).
- Use pointer events (not HTML5 drag and drop) so mouse, pen and touch share one code path. Use a single drag controller with window listeners, and update during drags inside `requestAnimationFrame`.
- A `PlanStore` interface over localStorage, so sync can be added later.

## Working agreements

- Match the prototype's interactions exactly, including the keyboard and touch paths, unless the user asks for a change.
- Keep the copy plain and in the user's terms ("tiles", "left to place", "over budget").
- Before calling the port done, test it in a browser: drag from the ledger, move, resize from both edges, the touch tap-to-arm path, undo, a reload that keeps state, and both color themes.
