# Browser support

This is a cutting-edge app, built first for its author's own up-to-date browsers. Baseline Newly available features are fine to use. Where a fallback exists and is cheap, use it. Where there is none, or it isn't worth its code, list the feature here so it's a known gap, not a surprise. Polyfills are loaded only when feature detection says they're needed (see [`docs/LOADING.md`](../LOADING.md) for where everything loads), and never in the initial bundle: each one comes in through a dynamic `import()`, which Vite splits into its own chunk, so browsers that don't need it never download it. Check the build output to confirm the chunk is separate. Versions are from MDN's browser compat data.

**With a fallback, or degrading on purpose:**

| Feature | Supported from | Without it |
| --- | --- | --- |
| SQLite in OPFS (`createSyncAccessHandle`), Web Locks, BroadcastChannel, cross-origin isolation | Chrome 102, Firefox 111, Safari 15.4 | The lower storage levels (see Progressive enhancement in [Persistence](persistence.md)). |
| `<meta name="text-scale">` | Chrome 146 | Ignored. Browser text size and zoom still work. |
| View Transitions | Chrome 111, Firefox 144, Safari 18 | Changes apply without the animation. |
| `clip-path: shape()` for the wavy progress bar | Chrome 135, Firefox 148, Safari 18.4 | The bar stays flat. |
| `forced-colors` rules, `forced-color-adjust`, `Mark` | Chrome, Firefox (Windows High Contrast) | Not needed where forced colors don't exist. |
| Translucent colors | `color-mix()`: Chrome 111, Firefox 113, Safari 16.2 | Used instead of the relative color syntax (`rgb(from …)`, Safari 18), with the same result. |
| `light-dark()` in every color token | Chrome 123, Firefox 120, Safari 17.5 | Light mode only: an `@supports not` block in the tokens gives every color its light value (a test checks they match), and the theme setting has no effect. The contrast levels sit inside `@supports (color: light-dark(#000, #fff))`, so these browsers stay at standard contrast, and the Contrast setting has no effect either. |
| `prefers-contrast` | Chrome 96, Firefox 101, Safari 14.1 | Standard contrast. The Contrast setting still works. |
| `clip-path: shape()` for activity shapes | Chrome 135, Firefox 148, Safari 18.4 | Every swatch is a circle, so activities differ by color only, and the shape picker shows circles. |
| Popover API for the menus, the placing toolbar and snackbars | Chrome 114, Firefox 125, Safari 17 | OddBird's [`@oddbird/popover-polyfill`](https://github.com/oddbird/popover-polyfill), loaded only when `"popover" in HTMLElement.prototype` is false. It can't add the real `:popover-open` pseudo-class and sets a `.\:popover-open` class instead, so popover rules must match both with `:is(:popover-open, .\:popover-open)`, or older browsers drop the whole rule. |
| Temporal, for dates and times | Chrome 144, Firefox 139, not yet in Safari | FullCalendar's [`temporal-polyfill`](https://github.com/fullcalendar/temporal-polyfill) (MIT, 20 KB gzipped), loaded with a dynamic `import()` only when `globalThis.Temporal` is missing, and awaited before the app renders. Chosen over the proposal champions' `@js-temporal/polyfill`, whose README doesn't call it ready for production yet, and which is 47 KB gzipped. |
| `Intl.DurationFormat`, for lengths | Chrome 129, Firefox 136, Safari 16.4 | FormatJS's [`@formatjs/intl-durationformat`](https://formatjs.github.io/docs/polyfills/intl-durationformat) (MIT, 18 KB gzipped), loaded the same way when `Intl.DurationFormat` is missing. It uses the browser's `Intl.NumberFormat` for the units, so it needs no locale data. |
| `Intl.Segmenter`, to cut a long activity name without splitting a character | Chrome 87, Firefox 125, Safari 14.1 | The name is cut by code points, which can split an emoji made of several (a flag, a family) in half. The limit is still 60 code points, the same as the database's check. |
| `using` and `await using`, with `Symbol.dispose`, `Symbol.asyncDispose`, `DisposableStack` and `AsyncDisposableStack`, for cleanup | Chrome 134, Firefox 141, not yet in Safari | The build lowers the syntax to `try`/`finally`. core-js's symbols and stacks ([`src/polyfill/disposal.ts`](../../src/polyfill/disposal.ts), MIT, 7 KB gzipped) load the same way as the other polyfills when `AsyncDisposableStack` is missing. |
| Iterator helpers (`map`, `filter`, `take` and the rest on iterators, `Iterator.from()`), for lazy chains in the plan logic | Chrome 122, Firefox 131, Safari 18.4 | core-js's iterator helpers (`core-js/es/iterator`, MIT, 11 KB gzipped), loaded the same way when `Iterator.prototype.toArray` is missing. |
| `accent-color` and `scrollbar-color`, for native controls and scrollbars in the theme's colors | Chrome 93 and 121, Firefox 92 and 64, Safari 26.2 | Native controls and scrollbars keep the system's colors. |
| Trusted Types | Chrome 83, Firefox 148, Safari 26 | Not enforced: the page works the same, without the guard. Development in any current browser still catches mistakes. |
| Anchor positioning for the add-block menu | Chrome 125, Firefox 147, Safari 26 | OddBird's [`@oddbird/css-anchor-positioning`](https://github.com/oddbird/css-anchor-positioning) polyfill, loaded with a dynamic `import()` only when `"anchorName" in document.documentElement.style` is false, so other browsers never download it. It needs an explicit `anchor-name` on the slot (no implicit anchors) and `anchor()` insets instead of `position-area` on the popover. Check whether it has to run again when the menu moves to another slot. |

Everything else in use is older than these: cascade layers, CSS nesting, subgrid, `:has()`, `:user-invalid`, `color-mix()`, `linear()` easing, `<dialog>` and `@starting-style`. So the full look needs Chrome 135, Firefox 148 or Safari 18.4. Below that, shapes become circles, and below Chrome 123, Firefox 120 or Safari 17.5 the app is light only. With the polyfills, the floor is set by `:user-invalid` and `:has()`: about Chrome 119, Firefox 121 and Safari 16.5. `@starting-style` only animates, so without it things appear without a transition.

## Waiting for wider support

What changes once a feature is widely available, so the workaround doesn't outlive its reason. Add a row whenever something is built around a missing feature, and go through the list when the browser floor above moves.

| Waiting for | Missing in | Then |
| --- | --- | --- |
| Typed `attr()` (`attr(data-lines type(<number>), 2)`) | Safari (only in Technology Preview); in Chrome 133 and Firefox 155 | Move the values set as custom properties in `style` (a block's `--name-lines`, top and height, an activity's `--activity-shape`) to `data-` attributes that CSS reads with `attr()`. Once nothing needs inline `style` attributes any more, drop `'unsafe-inline'` from `style-src` (see [Security](security.md)). |
| Temporal | Safari | Remove `temporal-polyfill` and its feature check, which also takes the wait out of startup. |
| Popover API (Safari 17) | Below the floor | Remove `@oddbird/popover-polyfill` and the `.\:popover-open` half of every popover selector. |
| Anchor positioning (Firefox 147, Safari 26) | Below the floor | Remove `@oddbird/css-anchor-positioning`, and use `position-area` and implicit anchors instead of the explicit `anchor-name` and `anchor()` insets it needs. |
| `Intl.DurationFormat` (Safari 16.4) | Below the floor | Remove `@formatjs/intl-durationformat` and its feature check. |
| Iterator helpers (Chrome 122, Firefox 131, Safari 18.4) | Firefox before 131, Safari before 18.4 | Remove `core-js` and its feature check. |
| `using` and the disposable stacks | Safari | Remove [`src/polyfill/disposal.ts`](../../src/polyfill/disposal.ts) and its feature check. The build keeps lowering the syntax until the build target includes it. |
| `Intl.Segmenter` (Firefox 125) | Firefox before 125 | Remove the code-point fallback in [`src/plan/activity/name.ts`](../../src/plan/activity/name.ts) and create the Segmenter directly. |
| `light-dark()` (Chrome 123, Firefox 120, Safari 17.5) | Below the floor | Remove the `@supports not (color: light-dark(…))` blocks from the tokens and the test that checks them. |
| `clip-path: shape()` (Chrome 135, Firefox 148, Safari 18.4) | Below the floor | Remove the circle fallback for swatches and the shape picker. |
