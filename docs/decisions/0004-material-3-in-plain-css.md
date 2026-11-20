# 0004 Material 3 Expressive in plain CSS, from Google's sources only

**Status:** Accepted, 2026-10-15, when the spec was reworked after the prototype.

## Context

The prototype had a look of its own. The app should feel playful and personal: a planner can feel like a chore, and this one should feel like yours ([Design](../spec/design.md)). Material 3 Expressive, Google's 2025 update of Material Design 3, is about bold shapes, lively color, emphasized type and springy motion.

## Decision

- **The app follows Material 3 Expressive**, leaning expressive wherever Google's guidance allows, and never at the cost of clutter, legibility or accessibility.
- **It is built with plain CSS**, from the tokens in [`docs/design/m3-tokens.css`](../design/m3-tokens.css), and the components are built in the project, without a component library.
- **Google is the only source**: m3.material.io, the official Material 3 Design Kit in Figma, and Google's own code (androidx `material3/tokens`, material-color-utilities, Material Symbols, Google Fonts). Colors and shapes are generated from Google's code by scripts ([`scripts/build-colors.ts`](../../scripts/build-colors.ts), [`scripts/build-shapes.ts`](../../scripts/build-shapes.ts)), never written by hand.
- **Only the project's author approves a departure** from Google's guidance, and each approved one is listed in [Deviations](../spec/design.md#deviations).

## Alternatives

- **Third-party Material libraries** (MUI, Vuetify, Flutter packages and the like). Rejected as sources: their values and patterns aren't Google's.
- **Google's own Material web components.** Rejected: they give less control over the result, and when the project's author last checked, they weren't fully up to date and did things the author didn't want (2026-11-20).
- **Keeping the prototype's look**, or another design system. Not recorded beyond the goal of an expressive, personal app.

## Consequences

- **Every component is built and maintained here**, styled with the CSS guidelines ([`docs/guidelines/css.md`](../guidelines/css.md)): cascade layers, rem, intrinsic sizing, logical properties, forced colors.
- **m3.material.io builds its pages with JavaScript**, so reading it takes a real browser, and the Figma kit needs a signed-in account.
- **Where Google's guidance doesn't cover a case**, such as an over-budget progress bar or a layout at 320 CSS px with 200% text, the departure waits for the author's approval before it's built.
- The [design canvas](https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk) shows every screen and state, and the extracted tokens follow it.
