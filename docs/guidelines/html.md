---
paths:
  - "**/*.tsx"
  - "**/*.html"
---

# HTML

How the markup is written, in JSX and in `index.html`. It adds to `docs/guidelines/principles.md`, which always applies; its rule of least power is why HTML comes first.

**HTML describes the document; CSS decides how it looks.** The markup holds the structure and all the information, so that machines that don't draw the page can read it: screen readers, search engines, reader mode, translation tools, scripts. It doesn't care about appearance. With CSS any element can look like any other and take any display, so there's never a visual reason to pick one element over another.

**The test: turn off all CSS.** The page should still make sense as a plain document: headings in order, lists as lists, buttons as buttons, each label with its field, and nothing that only makes sense because of where it sits on the screen. We're used to seeing pages visually, but an HTML page is the structure of a document. (Firefox: View › Page Style › No Style. Chromium: block the stylesheets in DevTools.)

**The first rule of ARIA:** if a native element or attribute already has the meaning and behavior you need, use it instead of adding a role, state or property to something else ([Using ARIA](https://www.w3.org/TR/using-aria/#rule1)). ARIA changes only what assistive technology hears, not what the element does, so a `<div role="button">` still needs focus, keyboard and activation built by hand, and a `<button role="radio">` still isn't part of a radio group.

**Choose each element for its meaning.** Landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`), headings that don't skip levels, `<ul>`/`<ol>`/`<dl>` for lists, `<button>` for actions and `<a>` for navigation, `<form>`, `<label>` and `<fieldset>`, `<dialog>`, `<time>`. Use a native element instead of a generic one with ARIA on it, and don't override an element's own semantics with ARIA.

**No elements for styling.** A `<div>` or `<span>` that exists only to give CSS a box is a sign the layout belongs in CSS. The common case is a grid mimicked with flexbox: a flex column of flex `<div>` rows, each wrapping one row's parts so they sit side by side. Make the parent a grid instead and let the parts be its items, or, when each part has to line up across rows or cards, let every row take the parent's columns over with subgrid (see Grid in `docs/guidelines/css.md`). The activity list does this: an `<li>` holds the shape, the name, the hours left, the edit button and the progress bar directly, and the list's columns line them up. A wrapper is right when it groups things that belong together in the document, such as an activity's name with its budget, or a field with its message, and then it's the element that says what the group is, where one exists.

**What an element is, how it's configured and what state it's in are three different things**, and each has its own place:

- **A class says what it is:** the component (`.button`, `.navigation-rail`, `.activity-list`) or a part of one (`.name`, `.drag-handle`). Utilities that combine with anything stay classes too: the type roles, `.muted`, the activity colors.
- **A `data-` attribute configures it:** its variant, size or shape, as in `<button class="button" data-variant="tonal" data-size="extra-small">`. One attribute per choice keeps the choices exclusive (`class="button filled tonal"` can be written, `data-variant` holds one value), the `data-` prefix is reserved for authors so it never clashes with a future HTML attribute, and it's the same shape of API as a native element's (`<input type="date">`) or a custom element's, so components with and without JavaScript are configured the same way.
- **State comes from the platform**, native first, as the first rule of ARIA asks: the element's own attributes and pseudo-classes (`disabled`, `open`, `checked`, `:checked`, `:user-invalid`, `:focus-within`, `:popover-open`), and ARIA only where HTML has nothing (`aria-current`, `aria-expanded` on a button that opens something other than a `<details>`, `aria-invalid` next to `:user-invalid` so screen readers hear the error at the same moment). CSS styles those, so what's drawn can't drift from what assistive technology announces. The expanded navigation rail is styled from its menu button's `aria-expanded` through `:has()`, today's weekday from `aria-current="date"`, and a text field's error from `:user-invalid` and `aria-invalid`, with no class repeating any of them. A `data-` attribute holds state only where nothing native or in ARIA means it, such as a block's `data-length="short"`.

**Boolean attributes are present or absent**, never `"true"` or `"false"`: `disabled="false"` still disables. That holds for HTML's boolean attributes and for our boolean `data-` attributes, such as `data-icon-only`. In Solid 2.0, pass a boolean: `true` renders the bare attribute and `false`, `null` or `undefined` removes it, for any attribute (`setAttribute` in `@solidjs/web` 2.0.0-rc.14), so `data-icon-only={isIconOnly()}` is right as it is. **ARIA is the exception:** its states are values, not boolean attributes, and `aria-expanded="false"` says something. Pass them as strings, `aria-expanded={isExpanded() ? "true" : "false"}`; a boolean would remove `aria-pressed` instead of setting it to `"false"`, and render `aria-expanded=""` instead of `"true"`.

**Let the document hold the state it can.** Native elements keep their own state: an `<input>` its value and validity, a `<details>` or `<dialog>` whether it's open, a radio group which option is checked, a popover whether it shows. Read that state when it's needed and style from it, instead of mirroring it into a signal that can disagree with it. The plan itself still lives in the store and the database; the page shows it. What the page holds is state about the page, and putting it in attributes keeps it visible to CSS, to assistive technology and to tests alike.

**Times and lengths are `<time>` elements**, with the formatted text for people and a `datetime` value for machines, which Temporal's `toString()` produces (see `docs/spec/dates-and-language.md`).

**TypeScript doesn't check `data-` values in JSX**, so `data-variant="filed"` compiles and matches nothing, as a misspelled class would. If that starts to bite, a small typed Solid component around the element can narrow the values.

**`display: contents`** is for an element that belongs in the structure but is in the way of the layout: its own box disappears and its children join its parent's layout, while it stays in the document. Browsers have dropped such elements from the accessibility tree in the past, so keep it off interactive elements (buttons, links, form controls), and check the accessibility tree before using it on lists, tables or headings.

**The design canvas is a visual reference, not a markup one.** Its boards use wrapper `<div>`s and inline styles to draw a state quickly. Build the app's markup from the document's structure, and its look from the stylesheet.
