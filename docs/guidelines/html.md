---
paths:
  - "**/*.tsx"
  - "**/*.html"
---

# HTML

How the markup is written, in JSX and in `index.html`. It adds to `docs/guidelines/principles.md`, which always applies; its rule of least power is why HTML comes first.

**HTML describes the document; CSS decides how it looks.** The markup holds the structure and all the information, so that machines that don't draw the page can read it: screen readers, search engines, reader mode, translation tools, scripts. It doesn't care about appearance. With CSS any element can look like any other and take any display, so there's never a visual reason to pick one element over another.

**The test: turn off all CSS.** The page should still make sense as a plain document: headings in order, lists as lists, buttons as buttons, each label with its field, and nothing that only makes sense because of where it sits on the screen. We're used to seeing pages visually, but an HTML page is the structure of a document. (Firefox: View › Page Style › No Style. Chromium: block the stylesheets in DevTools.)

**Choose each element for its meaning.** Landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`), headings that don't skip levels, `<ul>`/`<ol>`/`<dl>` for lists, `<button>` for actions and `<a>` for navigation, `<form>`, `<label>` and `<fieldset>`, `<dialog>`, `<time>`. Use a native element instead of a generic one with ARIA on it, and don't override an element's own semantics with ARIA.

**No elements for styling.** A `<div>` or `<span>` that exists only to give CSS a box is a sign the layout belongs in CSS. The common case is a grid mimicked with flexbox: a flex column of flex `<div>` rows, each wrapping one row's parts so they sit side by side. Make the parent a grid instead and let the parts be its items, or, when each part has to line up across rows or cards, let every row take the parent's columns over with subgrid (see Grid in `docs/guidelines/css.md`). The activity list does this: an `<li>` holds the shape, the name, the hours left, the edit button and the progress bar directly, and the list's columns line them up. A wrapper is right when it groups things that belong together in the document, such as an activity's name with its budget, or a field with its message, and then it's the element that says what the group is, where one exists.

**`display: contents`** is for an element that belongs in the structure but is in the way of the layout: its own box disappears and its children join its parent's layout, while it stays in the document. Browsers have dropped such elements from the accessibility tree in the past, so keep it off interactive elements (buttons, links, form controls), and check the accessibility tree before using it on lists, tables or headings.

**The design canvas is a visual reference, not a markup one.** Its boards use wrapper `<div>`s and inline styles to draw a state quickly. Build the app's markup from the document's structure, and its look from the stylesheet.
