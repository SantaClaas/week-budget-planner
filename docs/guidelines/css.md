---
paths:
  - "**/*.css"
---

# CSS

How the styles are written. It adds to `docs/guidelines/principles.md`, which always applies, and the same rules hold for styles set from TypeScript. The design itself, Material 3 Expressive, is in `docs/spec/design.md`, and its tokens and components in `docs/design/m3-tokens.css`.

**Google is the only source for Material Design**, and only the user approves a deviation from it (see `CLAUDE.md`). Build the components (navigation bar, bottom sheet, snackbar, floating toolbar and so on) in plain CSS, without a component library, and use the `modern-web-guidance` skill before writing a new one.

**Cascade layers.** Declare the order once: `@layer reset, base, theme, components, utilities;`. A later layer always wins, so no selector needs extra specificity to beat an earlier one. Use `:where()` inside a layer for defaults that should be easy to override.

- `reset`: removes browser defaults, with element selectors only. No global `*` rule, because it can't be overridden by lower layers or web components.
- `base`: the document's own font, colors and links.
- `theme`: the design tokens as custom properties (`m3-shapes.css` puts its shapes here itself).
- `components`: Material's components and the app's own.
- `utilities`: single-purpose classes that combine with anything: the type roles, `.muted`, the activity colors.

**Express intent in selectors.** A state that applies to some variants names them, instead of applying to all and being undone for the rest: `&:is(.filled, .tonal):disabled { … }`, not `&:disabled { … }` followed by `&.text:disabled { background: transparent }`. Then rules can't fight when they're reordered. Write hover and pressed states as `:hover:not(:disabled)` for the same reason.

**Avoid px.** Sizes are relative, so the user's text size setting works (WCAG 1.4.4 Resize Text, 1.4.10 Reflow).

- Google's dp and sp become rem by dividing by 16: 16dp = 1rem. (dp is a density-independent pixel, one CSS px at standard density; sp is the same but also follows the text size.)
- Breakpoints use `em`, so larger text switches to the phone layout sooner.
- px is only for hairlines of 1–2px: borders, outlines, grid lines, selection rings.
- Never set a font size on `:root` or `html`. `index.html` opts into the operating system's text size with `<meta name="text-scale" content="scale">`.
- Controls that hold text use a minimum height and grow with the text instead of clipping it.

**Intrinsic sizing first.** Let content decide how big things are, and let the layout share out the space: flex and grid with `fr`, `minmax()`, `auto`, `fit-content`, `min-content` and `max-content`, wrapping rows (`flex-wrap: wrap`) and gaps. Content changes in ways a fixed size can't foresee: larger text, a translation, a long name.

- Before writing `width` or `height`, ask what you really want. Usually it's a limit, not a size: "at least this tall so it's easy to tap" is `min-block-size`, "no wider than a comfortable line" is `max-inline-size`, "at least 96dp, wider if a label needs it" is `min-inline-size` with `inline-size: fit-content`.
- A fixed size is right for things that must be exact and can't hold text that grows: icons, swatches, drag handles, the active indicator around an icon.
- A row that runs out of room should wrap, not squeeze its items or overflow. Give the item that can give way a flexible basis with a maximum (`flex: 1 1 20rem; max-inline-size: 27.5rem`), so the others keep their natural size.
- Let text wrap. `white-space: nowrap` is for single-line layouts that end in an ellipsis on purpose, such as a short block.

**Logical properties where the reading direction matters.** Use the logical form (`inset-inline-start`, `padding-inline`, `margin-block-end`, `border-start-start-radius`, `text-align: start`) for anything that follows the direction of the text: the start and end of a row, a label at the start of a field, the trailing text of a list item, the first and last item of a group, the end of a progress bar. They flip correctly in right-to-left languages and in translation tools, at no cost. Ask "should this flip in a right-to-left language?" If not, keep the physical property: a bottom sheet is anchored to the bottom of the screen, a sticky header to the top, a shadow falls down.

**Forced colors.** Windows High Contrast drops shadows, gradients and background colors. Anything that shows a boundary or a state only that way needs an alternative under `@media (forced-colors: active)`: a border or outline in a system color (`CanvasText`, `ButtonBorder`, `Highlight`). Use `forced-color-adjust: none` only where the color is the information, such as an activity's swatch, and then draw with system colors or the activity's own.

**Nesting.** Use CSS nesting to keep a component's states, parts and media queries inside its rule, like `.navigation-rail { … &.expanded { … } }`. Start every nested selector with `&` (`& .icon`, not `.icon`): browsers before Chrome 120 and Safari 17.2 drop a nested rule that doesn't, and with it nesting works from Chrome 112, Firefox 117 and Safari 16.5, below the app's floor. Keep it shallow: about three levels at most, since each level adds specificity and makes the selector harder to find by searching.

See `docs/spec/design.md` for the details and for Material 3 Expressive itself.
