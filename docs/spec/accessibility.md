---
paths:
  - "**/*.tsx"
  - "**/*.html"
---

# Screen readers and the keyboard

What assistive technology reads and how the keyboard moves, screen by screen. Everything a pointer can do has a keyboard way (see [Interactions](interactions.md)), and everything the screen shows has a text equivalent. The markup rules behind it (native elements first, then ARIA) are in [`docs/guidelines/html.md`](../guidelines/html.md); the focus ring, forced colors and live regions are under Accessibility in [Design](design.md).

## Names and descriptions

- **A name says what a control is; a description adds the rest.** Supporting text ("Saves week-budget-planner-2026-10-09.db", "System is currently dark.") is linked with `aria-describedby`, not packed into the name, so "Export database" stays short and reads the same in a screen reader's list of buttons. Link it to the control the text is about, not to a group around it: screen readers read a focused control's description, but not all of them read a group's when focus enters it (Orca doesn't).
- **The visible label is the name** wherever there is one: a group's visible title is its `<legend>`, or, where the layout puts the title outside the group (as Settings does), it names the group through `aria-labelledby`. Never a second, hidden legend next to a visible title.
- **Spoken times and lengths are spelled out.** Visible text on blocks and day totals is compact ("1h30", "3h placed", "Mon"), which screen readers read letter by letter. Names and visually hidden text use the long styles: `Intl.DurationFormat` with `style: "long"` ("1 hour, 30 minutes") and the long weekday ("Monday"). The compact visible text is then `aria-hidden`, so nothing is read twice. Everywhere else the short copy ("1 h 30 min left to place") stays as it is.
- **Titles and their text read as separate sentences.** A title and the text under it (a card's title, an alert's first line) are separate block elements, a heading or a `<p>` each, never two inline spans, which run together ("couldn't be openedSo your plan").

## Pages and navigation

- **Landmarks:** the navigation rail or the navigation bar is a `<nav>` named "Sections"; each page is the `<main>`, and its top app bar the page's `<header>` inside it. The page's name in the app bar is its `<h1>`. The live region for snackbars and the save status sits outside `<main>`, so it outlives a change of page.
- **The destinations are links**, with `aria-current="page"` on the one shown: "Week, current page, link". The rail's menu button is a button with `aria-expanded`, named for what it does ("Expand navigation", "Collapse navigation").
- **Moving to another page moves focus to its `<h1>`** (with `tabindex="-1"`, and no focus ring, since it isn't a control), so a screen reader reads the new page's name, and the next Tab starts at the top of the new page. The document's title changes with it (see Pages and URLs in [Layout](layout.md)). A first load and Back or Forward leave focus where the browser puts it.
- **"Page not found"** is a page like the others: its name is the `<h1>` and the document's title, so a screen reader user who followed a broken link hears that it didn't lead anywhere, instead of landing on Week without a word.
- **Undo** is an icon button named "Undo", disabled while there's nothing to undo. Ctrl/Cmd+Z works anywhere outside a form field, as the button does.
- **The save status** is a link named by its text ("Saved in this browser"), described by "Your data in Settings". Changes of its text are announced through the shared live region, except "Saving…".

## The week

The week is a region that scrolls, holding a list of seven days, and each day a list of its blocks, in start order:

```html
<section class="week-scroller" aria-label="Week" tabindex="0">
<ol class="days" aria-label="Days">
  <li class="day">
    <h2><span aria-hidden="true">Mon <time datetime="PT3H">3h</time> placed</span><span class="visually-hidden">Monday, 3 hours placed</span></h2>
    <ol class="blocks">
      <li><button class="block" aria-pressed="false" aria-describedby="block-keys">…</button></li>
      …
    </ol>
  </li>
  …
</ol>
</section>
<p id="block-keys" hidden>Arrow keys move the block, Shift and the arrow keys change its length, Delete removes it.</p>
```

- **The week scrolls inside its own region**, named "Week", so a screen reader hears "Week, region" and then "Days, list, 7 items". The region takes focus (`tabindex="0"`) so the keyboard can scroll it with the arrow and page keys; once blocks and the empty slot take focus, moving between them scrolls the week as well.
- **The day header row is the days' own headings.** Each day's `<h2>` sits in the sticky header row through the grid (the day is a subgrid item spanning the header row and its column), so there's no separate row of headers to keep in step, and a screen reader can jump between days by heading.
- **The hour gutter, the hour lines and the day-hours shading are `aria-hidden`.** The times are in the blocks' names.
- **A block is a `<button>`** in Tab order, by day and then start. Its name is the activity, the day and the range, and the length: "Statistics lecture, Monday 10:00 to 11:30, 1 hour, 30 minutes" (as in the prototype). It's pressed (`aria-pressed="true"`) while selected. Its description gives the keys. The remove button is the block's sibling in the same `<li>`, not inside it (a button can't contain a button), and out of Tab order (`tabindex="-1"`), since Delete does the same.
- **An overnight block is one button,** in its first day's list, named with both days: "Work, Tuesday 22:00 to Wednesday 02:00, 4 hours". Its second part is an `<li>` in the next day's list without a button, and reads "Work, continued from Tuesday, until 02:00", so a screen reader browsing Wednesday knows the morning is taken. A pointer can still grab the second part.
- **The keys on a focused block** are those in [Interactions](interactions.md): Up and Down move it 15 minutes, Shift with Up or Down changes its length, Left and Right change the day, Delete or Backspace removes it, Escape deselects. After a move, focus stays on the block, and its new name is announced through the shared live region ("Moved to Tuesday 10:00 to 11:30"), since screen readers don't reliably read a focused element's changed name.
- **Empty slots are reached through one slot in Tab order**, after the blocks: the focused empty slot, a `<button>` drawn as the highlighted slot with a focus ring. It starts at the first free slot of the day hours and remembers where it was. Up and Down move it 15 minutes and Left and Right a day, skipping slots that blocks cover; Page Up and Page Down move an hour. Its name is the slot: "Empty slot, Tuesday 10:00". Enter or Space opens "Add block" there, or, while placing, adds a block of the placing activity. Each move renders a new button for the new slot and focuses it, so it's announced as a new focus. It never moves past the week's ends; at an edge, the key does nothing and the page scrolls as usual.

## Activities

- **Each activity row starts with a `<button>` that starts placing**, as in the prototype, pressed (`aria-pressed`) while that activity is placing. Its name is the activity's name, and its description the budget and what's left ("1 h 30 min per day, 3 days. 1 h 30 min left to place."). It's also what a pointer drags. "Edit Gym" (desktop) and "Options for Gym" (phone) are separate buttons after it. The progress bar is `aria-hidden`: the text already says what it shows.
- **The example-week note** ("This is an example week. Change it, or start with an empty one.") describes its two buttons, "Keep these" and "Start empty", with `aria-describedby`, so their context is read when they get focus.

## Add block

- **On wide screens it looks like Material's menu, but it's a popover with a list of buttons**, not `role="menu"`: a real menu promises arrow-key navigation and one Tab stop, and the popover doesn't need them. Its heading is "Add block · Friday 14:00". Opening it moves focus to the first activity; Tab moves through the list; Escape or choosing closes it and returns focus to the slot.
- **On phones it's a modal `<dialog>`** (the bottom sheet). The length stepper is a `<fieldset>` with the legend "Length": the "15 minutes shorter" and "15 minutes longer" buttons, and the length between them in an `<output>`, which announces each change by itself.
- **Each activity button's name is its activity**, and its description what's left ("3 h left · usually 1 h 30 min", "All placed · this would go over budget").

## Settings

- **Theme, Contrast and Motion** are each a `<fieldset>` named by its visible title (`aria-labelledby`). The supporting text ("System is currently dark.") says what System resolves to, so it describes the System option's radio input (`aria-describedby`): "System, selected radio button, System is currently dark." Contrast stays at standard contrast in every mode, so it can always be read and changed back.
- **The Your data buttons** (Export database, Import database, Delete all data, Keep my plan) are named by their title and described by their supporting text.

## Newer versions

- **The full page at start-up** ("Your plan was saved by a newer version") has its title as a heading and its text as a paragraph, so the title can be found by heading. Its Reload button is described by both (`aria-describedby`), so someone who tabs straight to it hears why: "Reload, button. Your plan was saved by a newer version. Reload to update Week Budget Planner. Your plan is safe, and nothing was changed."
- **The reload snackbar** ("Week Budget Planner was updated in another tab. This tab can't save until it reloads.") is announced once through the shared polite live region, like every snackbar. It doesn't take focus, so a screen reader user isn't pulled away from where they are. Its Reload button is reachable by Tab and described by the message (`aria-describedby`), so someone who missed the announcement, or reaches the button later, hears why it's there: "Reload, button. Week Budget Planner was updated in another tab. This tab can't save until it reloads." The Reload button in Settings › Your data is described by its notice's text the same way (see Tabs on different versions in [Persistence](persistence.md)).
- **While the plan is read-only**, blocks, empty slots and activities keep their names and stay in Tab order, so the plan can still be read. Their actions are disabled with `aria-disabled="true"` rather than `disabled`, which would take them out of Tab order and hide them from some screen readers. A key or click that would change the plan does nothing.

## Checking it

Check each screen and state with a screen reader before calling it done (see Screen reader checks in [`docs/guidelines/tests.md`](../guidelines/tests.md)), and with the keyboard alone: every block, every empty slot and every activity must be reachable and usable without a pointer. The automatic checks (the lint, the contrast tests, axe and the browser checks in [`e2e/accessibility.spec.ts`](../../e2e/accessibility.spec.ts)) catch what a machine can; add each new screen to them too (see Automatic accessibility checks in [`docs/guidelines/tests.md`](../guidelines/tests.md)).
