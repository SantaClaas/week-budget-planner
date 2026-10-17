# Week Budget Planner: product spec

This spec describes the behavior of the working prototype in `prototype/week-budget-planner.html`, plus the design decisions made after it (see "Changes from the prototype"). The SolidJS app should match it. When the spec and the prototype disagree, the spec wins for anything listed under "Changes from the prototype". For anything else the prototype is what the user has actually tried, so ask before diverging.

The visual design is the [design canvas](https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk) (private, ask the user for access). Its tokens are extracted to `docs/design/m3-tokens.css`.

## What it is

A planner for one reusable week (Monday to Sunday, no calendar dates). The user creates **activities** (university classes, work, the gym) and gives each one a **budget** of hours, either per week or per day. They then put **blocks** of those activities on a seven-column week, by dragging, by placing, or by tapping an empty slot, and move and resize them. Every activity shows live how much of its budget is still **left to place**.

The core loop is: set a budget, add blocks, resize them, and watch "left to place" count down to zero.

## Glossary

Use one name per thing, the same way in the UI copy, this spec and the code.

| Term | Meaning | Notes |
| --- | --- | --- |
| **Week** | The one reusable plan, Monday to Sunday. It has no dates. | Code: `Plan` |
| **Activity** | Something you budget time for, like a class, your job or the gym. It has a name, a color, a shape and a budget. | Code: `Activity` |
| **Budget** | How many hours an activity needs, counted per week ("4 h per week") or per day on a number of days ("1 h 30 min per day, 3 days"). | Code: `mode`, `budgetMinutes` (type `BudgetMinutes`), `days` (type `DayCount`) |
| **Block** | One piece of an activity on the week: a day, a start time and a length. You add, move, resize and remove blocks. | Was "tile" in the prototype. Code: `Block` |
| **Slot** | A 15-minute cell on the week. An empty slot has no block. Blocks start and end on slots. | Everything snaps to 15 min |
| **Length** | How long a block is, in minutes. | Code: `length`, type `Length` |
| **Overnight block** | A block that runs past midnight into the next day, for example a night shift from Tuesday 22:00 to Wednesday 02:00. It is one block, drawn in two parts. Sunday night runs into Monday morning. | |
| **Default length** | The length a new block gets: the per-day budget for per-day activities, otherwise 1 h 30 min, and never more than what is left. | |
| **Placed** | The total length of an activity's blocks. | |
| **Left to place** | Budget minus placed. At zero it reads "All placed". Below zero it is "Over budget". | |
| **Placing** | The mode you are in after picking an activity: every click or tap on an empty slot adds a block of it, until you press Done or nothing is left. | Was "armed" in the prototype |
| **Add block** | Click or tap an empty slot when you are not placing, then choose the activity. | Phone: a bottom sheet. Desktop: a menu |
| **First free slot** | The earliest gap that fits the default length, scanning Monday to Sunday. | |
| **Day hours** | The hours you are usually awake and planning, by default 07:00 to 22:00. The week opens scrolled to them, and "First free slot" only looks inside them. The week always shows all 24 hours. | Was "hours shown". Code: `dayStart`, `dayEnd` |
| **Example week** | Sample activities and blocks shown on first run, until you keep them or start empty. | |
| **Export / Import** | Save the whole database as a `.db` file, or replace this browser's data with one. | Settings › Your data |

Words not to use in the app: **tile** (say "block"), **ledger** (it's the "Activities" list), **arm / armed** (say "placing"), and **event, appointment, task, session** (they suggest dates or to-dos, and this is one reusable week). Code may keep internal names that aren't user-facing, but prefer the glossary terms for new code.

## Changes from the prototype

These were decided after the prototype and override it:

- **Material 3 Expressive** replaces the prototype's look (see Design). The interaction model stays the same unless listed here.
- **"Tile" is renamed "block"** and **"armed" is renamed "placing"** everywhere, including copy such as "Deleted Gym and its 3 blocks."
- **Add block from an empty slot.** Clicking or tapping an empty slot while not placing opens a chooser to add a block there. This is the main touch path, since dragging is hard on phones (see Interactions).
- **Blocks can cross midnight.** Moving a block keeps its length. If the new start leaves less of the day than the block's length, the rest overflows into the next day's column from 00:00. For example, a 4-hour block moved to start at 22:00 runs until 02:00 the next day. The week wraps, so Sunday continues into Monday. The prototype clamped blocks to one day.
- **The week shows all 24 hours** and opens scrolled to the day hours. The prototype showed only the hours shown (07:00–22:00 by default), growing to fit blocks. "Hours shown" is renamed **day hours**.
- **Activities have a shape as well as a color**, picked freely and independently, with distinct defaults (see Design). The shape replaces the prototype's vertical color bar and also shows small on each block.
- **Navigation is the same on every screen size.** Phones use a navigation bar with Week, Activities and Settings instead of stacking the panes, and wide screens a navigation rail with the same three destinations (see Layout).
- **Settings is a page**, holding the theme choice and the data actions (export, import, delete). The theme choice (System, Light, Dark) is new.
- **Names are spelled out** in the stored format and the database: `version` (was `v`), `budgetMinutes` (was `mins`), `activityId` (was `act`) and `length` (was `dur`). Nothing was stored in the old format outside the prototype, so there is no conversion.
- **The example week is marked with a time, not a boolean:** `exampleLoadedAt` says when it was loaded and is null once it's kept or replaced (the prototype stored `example: true`). See `docs/CODING-GUIDELINES.md` on stored booleans.
- **Ids are nanoids** from an alphabet without lookalike characters, so they can appear in URLs (see Data model). The prototype used `crypto.randomUUID()`.
- **Dates, times and lengths are formatted by the browser** with the `Intl` APIs, in the user's language and conventions, and dates use Temporal instead of `Date` (see Dates, times and language). The prototype built strings like "1 h 30 min" and "07:30" by hand.
- **The new-activity form** is behind the "New activity" floating action button once at least one activity exists: in the navigation rail on wide screens, on the Activities screen on phones. In the empty state it is shown open.

## Data model

One plan document per user. The stored shape is the same as `examples/example-week.json`:

```ts
type Plan = {
  version: 1;
  activities: Activity[];
  blocks: Block[];        // the blocks on the week
  dayStart: number;       // first of the day hours, 0..12 (default 7)
  dayEnd: number;         // end of the day hours, 13..24 (default 22)
  exampleLoadedAt: string | null; // when the example week was loaded (ISO 8601, UTC); null once it's kept or replaced
};

type Activity = {
  id: string;
  name: string;           // at most 60 characters
  hue: number;            // one of the 8 palette hues, see Design
  shape: string;          // one of the 35 Material shape names, for example "heart", see Design
  mode: "week" | "day";   // how the budget is counted
  budgetMinutes: number;  // budget in minutes, per week or per day; multiple of 15, at least 15
  days: number;           // 1..7, used only when mode === "day"
};

type Block = {
  id: string;
  activityId: string;     // Activity.id
  day: number;            // 0 = Monday … 6 = Sunday
  start: number;          // minutes from midnight, multiple of 15, 0..1425
  length: number;         // length in minutes, multiple of 15, 15..1440; start + length may pass 1440 (overnight block)
};
```

Ids are made with [nanoid](https://github.com/ai/nanoid)'s `customAlphabet`: 12 characters from `6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz`, which is `nolookalikesSafe` from `nanoid-dictionary`. It leaves out characters that look alike (1, l and I, 0 and O, and others) and vowels, so ids are easy to read back from a URL and never spell words. 36¹² is about 4.7 × 10¹⁸ (62 bits), plenty for one plan. nanoid draws its randomness from `crypto.getRandomValues()`, which, unlike `crypto.randomUUID()`, also works outside secure contexts. Ids are stored as text. A 12-character id is a third of a UUID string, and Turso's binary `uuid4()` wouldn't help, since ids are made in the browser and appear in URLs and files as text. Ids that come from storage, an import or the example week are kept as they are, as long as they are non-empty and at most 40 characters.

Time is stored as integer minutes and everything snaps to 15 minutes. Weekly budget: `target(activity) = activity.mode === "day" ? activity.budgetMinutes * activity.days : activity.budgetMinutes`. Placed: the sum of `length` over that activity's blocks. Left to place: `target − placed`. It can go negative, which means over budget.

A block covers the week minutes `[day * 1440 + start, day * 1440 + start + length)`, taken modulo 10080 (one week), so a block that starts on Sunday evening continues on Monday. Placed, left to place, overlaps and lanes, the first free slot and the per-day totals all work on these week minutes. A day's total counts only the part of each block that falls on that day.

Sanitize every loaded plan (from storage or sync): give activities with a missing or unknown `shape` their default shape (see Design), going through them in list order, clamp numbers, snap to 15, clamp `start` to 0..1425 and `length` to 15..1440 (the prototype's `sanitize()` instead clamped blocks to end by midnight; don't), give invalid or repeated ids new ones (blocks stay with the first activity that had their stored id), drop blocks whose activity no longer exists, and turn an `exampleLoadedAt` that isn't a valid date into null. The prototype's `sanitize()` is the reference.

**Checked values are branded types.** Every value above that has rules is its own type in the code, not a plain `number` or `string`: `ActivityId`, `BlockId`, `DayIndex` (0 is Monday, 6 is Sunday; Temporal's `dayOfWeek` is 1 to 7), `DayMinute` (a block's start), `WeekMinute` (a start on the whole week, for overlaps and slots), `Length`, `BudgetMinutes`, `DayCount` and `Hour` (the day hours). A hue or a shape is one of the listed values, as a literal type. Only a value's own sanitizer makes one, so a branded value is always valid, and the compiler keeps, for example, minutes of a day apart from minutes of the week. Each has two ways in:

- **A sanitizer** for data that was loaded or computed: it takes any number and returns the nearest valid value, as described above. `sanitizePlan` is made of them.
- **A strict parser** for what the user types or picks: it rejects a value out of range instead of clamping it, so the form can say what's wrong (see Activities under Interactions).

The database checks the same rules again with `CHECK` constraints on its columns (see Suggested tables), so nothing that skipped the types can be stored.

The theme choice is a device preference, not part of the plan. It isn't in the database or in exports: it lives in `localStorage` under `week-budget-planner.color-scheme`. The stored value is the CSS `color-scheme` value it stands for, `light` or `dark`, and System, which is `light dark`, removes the entry. It has to be readable before the first paint, which the database isn't (see Design, Theme). The copy calls it the theme; the code calls it the color scheme, after the CSS property (see Names in `docs/CODING-GUIDELINES.md`).

## Layout

### Wide screens (desktop and tablets, 52.5em and up)

- **Navigation rail** on the left, the full height of the window: what the navigation bar is on a phone, and never shown together with it. Its container fill is off, so it sits on the page background (m3.material.io allows this as long as items keep 3:1 contrast). From the top: 44dp of space, a menu button that expands and collapses the rail, the "New activity" floating action button, at least 40dp of space, then **Week**, **Activities** and **Settings** as one group, 4dp apart. Google asks for 3 to 7 destinations, so the rail has the same three as the bar. The FAB rests at elevation level 0, as Google asks for a FAB inside the rail.
  - **Collapsed** (the default; 96dp, androidx `NavigationRailCollapsedTokens`): the menu button shows `menu` and is named "Expand navigation". The FAB is 56dp with only its icon, named "New activity" with a tooltip. Destinations show the icon above the label, with the navigation bar's active indicator (56×32dp, `secondary-container`) and the filled icon when active.
  - **Expanded** (220 to 360dp, androidx `NavigationRailExpandedTokens`, standard: beside the page, which narrows to make room): the menu button shows `menu_open` and is named "Collapse navigation". The FAB becomes the extended "New activity" FAB. Destinations become rows with the label beside the icon (Label Large, 8dp apart), and the active indicator hugs both (56dp tall, 16dp leading space). The menu button carries `aria-expanded`.
  - **Week** is the week with the Activities pane beside it, Google's supporting-pane layout (a fixed 360dp pane beside the focus pane). **Activities** is the activity list as its own page (see below).
- **Top app bar:** the page's name as the headline ("Week", as on phones), the save status ("Saved in this browser", "Saving…", "Saved in limited storage", "Not saved") and an Undo icon button. The save status is a link to Settings › Your data (see Writes and undo).
- **Left pane, Activities** (360px wide, scrolls on its own):
  - The example-week card, shown only while `exampleLoadedAt` is set: "This is an example week. Change it, or start with an empty one." with "Keep these" and "Start empty".
  - A header, "Activities", with the total left to place.
  - The activity list. Each item has a color swatch, the name, the budget line ("4 h 30 min per week" or "1 h 30 min per day, 3 days"), the remaining figure on the right ("1 h 30 min / left to place", "All placed / 3 h", or "30 min / over budget"), a progress indicator, and an Edit icon button.
  - A hint line: "Drag an activity onto the week, or click an empty slot to add a block there."
  - The rail's "New activity" button opens the form at the top of this pane: name, hours (step 0.25), counted per week or per day, days (shown only for per day), a color picker with 8 colors, and a shape picker with the 35 shapes drawn in the chosen color.
- **Activities page** (the rail's Activities): the same list as the pane, in a centered column up to 48rem wide, under the summary ("12 h left to place across 4 activities"). Editing works as everywhere, inline in the list item, and the form has room to lay out name, hours and per week or per day on one line. The rail's "New activity" opens the form at the top of the list.
- **Right pane, the week:**
  - A summary ("20 h placed of 32 h · 12 h left to place") with an overall progress indicator.
  - Tools: a "Day hours" button (opens a menu with the two hour selects, for example "07:00 – 22:00") and "Clear week".
  - The grid. It has a sticky day header row (day name plus the total placed that day), a sticky hour gutter on the left, and 7 day columns. Columns are at least 6rem wide and the grid scrolls horizontally if needed. Weekend columns are slightly tinted, and today's weekday is marked in the header.
- **Floating:** the placing toolbar and snackbars (see Interactions), at the bottom center.

### Phones (under 52.5em)

- **Navigation bar** (64px) at the bottom with three destinations: **Week**, **Activities**, **Settings**.
- **Week:** a top app bar with the title "Week" and Undo (no overflow menu: Day hours and Clear week are in Settings › Week), then the summary and progress, then the grid filling the rest of the screen. About three days fit across, the next one is just visible at the edge, and the grid scrolls sideways with scroll snapping per day. The placing toolbar floats above the navigation bar.
- **Activities:** the same list as the wide-screen pane, with an extended "New activity" floating action button. Tapping an activity starts placing it and switches to Week.
- **Settings:** the same page as on wide screens. On phones it also holds "Day hours" and "Clear week", which on wide screens sit above the grid.

### Settings page

- **Appearance:** Theme, as a connected button group: System, Light, Dark. Supporting text under it says what System currently resolves to: "System is currently dark." It updates when the system setting changes.
- **Week** (phones only): Day hours, Clear week.
- **Your data:** "Your plan is stored only in this browser. Nothing is uploaded. Export it to keep a backup or to move it to another device." Then Export database, Import database, and Delete all data (in the error color).
- **Storage:** number of activities, number of blocks, database size.
- **About**, the last section: one list item that starts with the GitHub mark (see Deviations): "Version", with "2026-10-17 · 74ea982" (the date and the short commit hash) under it. The whole item is a link that opens the repository at that commit in a new tab, and it ends with the `open_in_new` icon instead of a chevron, so it reads as leaving the app. The icon's label says "Opens in a new tab". A build without git shows only the date, and the item opens the repository's main branch instead (see Version).
- On wide screens it is a full page next to the navigation rail, with Settings active in the rail. The rail's Week leads back.

### Version

Releases are numbered by date, not with semantic versioning. A version number like semver's tells whatever depends on a package whether an update could break it, and nothing depends on this app's version. Where compatibility does matter, for the database and the exported files, the migrations track it, and the app refuses a database or a file from a newer version (see Persistence).

- **The version is the date of the commit the app was built from**, as an ISO 8601 date in UTC (`2026-10-17`), plus that commit's hash. The commit's date rather than the build's keeps two builds of the same commit the same version, and the hash tells two releases on the same day apart.
- **The hash is optional.** A build without git, for example from a downloaded archive, has the build's date and no hash, and links to the repository's main branch instead of a commit.
- The build reads both from git (`vite-plugins/app-version.ts`) and gives them to the app as the module `virtual:app-version`. The link goes to `https://github.com/SantaClaas/week-budget-planner/tree/<hash>`, the repository at that commit, or to `…/tree/main` without one.

## Grid geometry

- 3rem per hour (`--hour`, 48px at the default text size), so 0.75rem per 15 minutes. The grid is sized in rem so it grows with the user's text size and blocks keep room for their text. The hour lines are solid and the half-hour lines are fainter.
- The grid always shows the whole day, 00:00 to 24:00 (72rem, 1152px at the default text size), and scrolls vertically inside its pane. The day header row and the hour gutter stay sticky.
- **Where the week opens:** scrolled so the top of the view is the earlier of the day hours' start (`dayStart`, 07:00 by default) and the earliest block start in the week, rounded down to the full hour. Only blocks that start on their own day count: the second part of an overnight block always starts at 00:00 and would otherwise pin the view to midnight. All days scroll together, so this is one position for the whole week. It is set when the week opens and when the day hours change, never while the user is working.
- **Day hours** are drawn on the grid: the hours outside them get a slightly darker background, like the weekend tint, so the usual day stands out without hiding the night.
- Overlapping blocks in a day sit side by side in lanes, like a standard calendar. Group blocks that overlap, then give each one the first lane whose last end is at or before its start.
- **Overnight blocks** are drawn as two parts: the end of the first day, with square bottom corners, and the start of the next day, with square top corners. Both parts show the full time range with a day marker ("Tue 22:00 – Wed 02:00 · 4h") and select, move and resize together. The first part has no bottom handle and the second part has no top handle. Moving either part moves the whole block, with the start taken from the first part.
- Block content: the name, then the time range and length ("10:00–11:30 · 1h30"). The name wraps onto as many lines as fit above the time, and ends in an ellipsis only where one more line would push the time out of the block. The block is a grid of two rows, `minmax(0, auto)` for the name and `auto` for the time, so the time always shows and the name takes what's left. For the ellipsis, the block sets `--name-lines` for `line-clamp`, from its height: the height left after its padding and one line of time, divided by the name's line height. The heights are in rem, so the count holds at any text size. If the time wraps to a second line, the grid still keeps it visible and only the name's last line is cut. The length can wrap to its own line. Blocks of 30 minutes or less show a single line, "Name · 30m". A 15-minute block has no top resize handle.
- **Activity shape on blocks:** a 12px swatch (the activity's shape in its solid color) sits in the block's top-right corner, 4px from the edges, and the name stops short of it. On blocks of 30 minutes or less it sits at the start of the single line, before the name, at 10px. 15-minute blocks have no room and show none. When the remove button shows (hover or selection) it takes the corner instead.

## Interactions

All of these must work with a mouse, touch and the keyboard.

**Adding blocks**
- **Drag from the Activities list** (mouse or pen): a press on an activity followed by more than 4px of movement starts a drag. A chip follows the pointer, and a dashed preview shows where the block will land. Dropping on a day creates the block. The start is the slot under the pointer.
- **Placing:** clicking or tapping an activity starts placing it. The placing toolbar appears: "Placing **Gym** · 1 h 30 min. Click a time slot." ("Tap a slot" on touch) with the activity's left-to-place figure, "Use first free slot" and "Done". While placing, a mouse hovering over the grid shows the preview, and each click or tap on an empty slot adds a block of the default length there. Placing stops on its own once that activity is all placed. Escape and Done also stop it.
- **Add block from an empty slot:** when not placing, clicking or tapping an empty slot highlights it and opens a chooser titled "Add block" with the day and start ("Tuesday · from 10:00"):
  - On phones it is a modal bottom sheet. On wide screens it is a menu anchored to the slot, on its right, or on its left when there's no room on the right (`position-try-fallbacks: flip-inline`), as on the week with the navigation rail expanded.
  - It lists the activities, those with the most left to place first. Activities that are all placed or over budget come last, dimmed but still selectable ("this would go over budget").
  - The phone sheet has a length stepper (− and +, 15 minutes per step), preset to the default length of the activity under focus. The desktop menu uses the default length, and the block can be resized afterwards.
  - It ends with "New activity…", which opens the new-activity form and then adds the block.
  - Choosing an activity adds the block, closes the chooser and shows a snackbar: "Added Gym · Tue 10:00–11:30" with Undo.
  - On touch, a tap on an empty slot must not fire while the user scrolls. Only a tap without movement opens the chooser.
- **First free slot:** scan the days in order, in 15-minute steps within the day hours, for a gap of the default length. For per-day activities, try days that don't have the activity yet first. If nothing fits, show a snackbar ("No free 1 h 30 min slot between 07:00 and 22:00.").
- **Default length:** for per-day activities it's `budgetMinutes`. For weekly ones it's 90 minutes (one lecture slot). Cap it at the remaining budget when some is left, and so it ends by the end of the day hours when it starts inside them. The minimum is 15.

**Editing blocks**
- **Move:** drag the block body, which can cross days. Keep the grab offset so the block doesn't jump. Snap to 15.
  - **Moving changes only the start.** Picking a block up and moving it changes its day and start time. The length never changes. The start is the slot under the block's top edge, anywhere from 00:00 to 23:45.
  - **Overflow into the next day:** if the start plus the length passes 24:00, the block becomes an overnight block. The part up to 24:00 stays in the column under the pointer, and the rest continues in the next day's column from 00:00. A 4-hour block moved to start at 22:00 shows 22:00–24:00 in its column and 00:00–02:00 in the next one. Moving it back up so it fits before 24:00 turns it back into a one-day block. Sunday overflows into Monday.
  - **While dragging:** both parts are previewed in place, as they will be stored. To reach a part that is scrolled out of view, the grid scrolls automatically when the pointer nears its top or bottom edge (see below).
- **Resize:** drag the top or bottom handle (7px tall, 4px on short blocks). The minimum is 15 minutes and the maximum is 24 hours. The top handle keeps the end fixed. Resizing stays within each part's own day: on an overnight block, the first part's top handle changes the start and the second part's bottom handle changes the end. A one-day block becomes an overnight block only by moving it.
- **Select:** a mouse press selects. On touch, the first tap only selects, and only a selected block can be dragged (`touch-action: none` applies only to the selected block and the handles), so the grid stays scrollable.
- **Remove:** the remove button on hover or selection, or Delete/Backspace when the block has focus.
- **Keyboard:** blocks are focusable. Up/Down moves 15 minutes and crosses midnight into the next or previous day, Shift+Up/Down resizes by 15 minutes (also across midnight), Left/Right changes the day, and Escape deselects. Empty slots must be reachable too, so the keyboard can open "Add block".
- Ignore clicks for about 350ms after a drag ends, so the click that ends a drag doesn't add a block or deselect.
- Scroll the grid automatically when dragging near its top or bottom edge.
- The progress indicators and the summary update live during a drag. Persist only when the drag ends, and only if something changed.

**Activities**
- Add with validation messages (from the strict parsers, see Data model): "Give the activity a name.", "Enter the hours it needs, for example 1.5.", "A day has 24 hours. Enter 24 or less.", "A week has 168 hours. Enter 168 or less.", "Enter how many days per week, from 1 to 7." Hours are rounded to 15 minutes.
- **Validation uses the platform's constraint validation**, not a form library and not CSS classes:
  - The inputs carry their own rules (`required`, `min`, `max`), and the browser decides what's invalid. For the rules attributes can't express, and to use the messages above instead of the browser's, set them with `setCustomValidity()` on the field: an empty string when it's valid, so `validationMessage` is always ours.
  - **Timing:** a field shows its error only once the user is done with it: when it loses focus, or when the form is submitted. That's what `:user-invalid` matches, so the error styling and the message (the text field's supporting text) hang off `:user-invalid`. No error shows on an untouched form or while typing for the first time. Run the field's check on every `input` event, so the error clears as soon as the value is fixed.
  - Submitting runs the browser's validation. Handle the `invalid` event with `preventDefault()` to hide the browser's bubble, since the message already shows under the field, and move focus to the first invalid field.
  - The message is linked to its field with `aria-describedby`. Set `aria-invalid` whenever the field matches `:user-invalid` (checked on `blur`, `focus` and `input`), so screen readers hear about the error at the same moment it appears on screen.
  - Hours accept the user's decimal separator ("1.5" and "1,5" in German), read with the separators from `Intl.NumberFormat(…).formatToParts()`.
- Edit inline in the list item (same form, plus Save, Cancel and Delete). Escape cancels.
- Deleting an activity also deletes its blocks. Show a snackbar with Undo: "Deleted Gym and its 3 blocks."
- A new activity gets a default color and shape, ideally ones no other activity uses yet (see Activity shapes under Design). The user can change both.

**History**
- Undo covers every change: block add, move, resize and remove, activity add, edit and delete, Clear week, and Start empty. It keeps up to 100 steps. Ctrl/Cmd+Z works when focus isn't in a form field. The snackbar Undo and the Undo icon button use the same stack.

## Persistence

In the prototype, the plan lived in the claude.ai artifact database. That API exists only inside claude.ai artifacts and is **not** carried over. The real app stores everything in a **SQLite database inside the browser**, set up the same way as [flashcut](https://github.com/SantaClaas/flashcut), with **Drizzle** added on top. There is no backend.

### Database engine (same as flashcut)

- `@tursodatabase/database-wasm`, persisted in OPFS. Import it from `@tursodatabase/database-wasm/vite`.
- It needs `SharedArrayBuffer`, so the page must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`) in dev, preview **and** production. Set the headers in `vite.config.ts` for `server` and `preview`, and keep `public/_headers` for hosts that read it. Production is GitHub Pages, which can't set headers, so a service worker adds them there (see Hosting).
- **Multiple tabs (already built in flashcut, reuse it):** OPFS allows one open database per origin. Flashcut's `src/db/client.ts` elects a leader with `navigator.locks.request(...)`. The tab holding the lock opens the database, runs migrations, and serves a `DbService` (`exec`/`run`/`get`/`all`/`exportFile`/`importFile`/`wipe`). `src/lib/broadcast-service.ts` exposes that service to the other tabs as a typed RPC proxy over BroadcastChannel. It handles request ids, provider discovery, retrying calls that were never sent when a tab gets promoted, and `CallLostError` for calls in flight when the leader changes. Copy both files with only renames (channel and lock names). Don't build a second mechanism.
- **Cross-tab updates:** after a write, broadcast a change event so other open tabs reload the plan (flashcut's `src/lib/broadcast.ts` pattern). A tab never receives its own broadcast.

### Drizzle (new compared to flashcut)

- Use `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4`, pinned exactly. The 1.0 line ships `drizzle-orm/tursodatabase/wasm` and a filesystem-free `drizzle-orm/tursodatabase/wasm-migrator`, and 0.45 doesn't have them. Check the installed package's types before relying on these details.
- **Schema** in `src/db/schema.ts`. Migrations are **generated** with `drizzle-kit generate` into `drizzle/` and committed. Never hand-edit an applied migration.
- **Drizzle sits on top of flashcut's RPC; it doesn't replace it.** Follower tabs have no local database object, so the app's Drizzle instance uses `drizzle-orm/sqlite-proxy`. That driver has no database of its own. It builds the SQL, calls one async callback with `(sql, params, method)`, and maps the returned rows to typed results. The callback just calls the existing `dbService`, which runs the SQL locally on the leader and over BroadcastChannel everywhere else. So every tab uses the same typed queries.
  - **Row shape:** the proxy expects rows as arrays of values in column order (one row for `method === "get"`, a list otherwise). Flashcut's `DbService` returns rows as objects, so add a method that returns arrays, for example using Turso's raw statement mode if its API has one (check it), and verify against Drizzle's sqlite-proxy docs and types.
  - **Atomic writes:** `db.transaction()` over the proxy would send BEGIN, the statements and COMMIT as separate RPC calls, so another tab's query could land in between. Instead, pass Drizzle's batch callback (`drizzle(callback, batchCallback, config)`) and add a `DbService.batch(statements)` that the leader runs inside one transaction (flashcut's `withTransaction`). Use `db.batch([...])` for every multi-statement user action.
- **Migrations are loaded only when a database needs them.** Each generated `migration.sql` becomes a chunk of its own (a lazy `import.meta.glob`). At open, one query reads the names of the applied migrations from Drizzle's `__drizzle_migrations` table. If none are pending, nothing else is loaded. Otherwise the leader loads the pending SQL files and Drizzle's migrator and passes only the pending migrations, since Drizzle runs every migration whose name isn't in its table yet. So migrations every database already has cost nothing but their name, however many there are. If the list grows long, new databases could later start from a baseline instead of replaying the full history.
- **Migrations run only on the leader**, on its real connection, before it starts serving, using the `wasm-migrator`, which takes the pending migrations' SQL as a `Record<string, string>` keyed by name. Drizzle tracks applied migrations in its own table. Don't mix that with flashcut's `PRAGMA user_version` scheme.
- **Tests** run in Node against `@tursodatabase/database` (the same async API) through `drizzle-orm/tursodatabase/database`, applying the same generated migrations. No browser is needed for repository tests.

### Suggested tables

Map the data model above roughly like this. Adjust it if Drizzle suggests better, but keep minutes as integers.

- `activities`: `id` text PK, `name`, `hue` int, `mode` text (`week`/`day`), `budget_minutes` int, `days` int, `shape` text, `position` int (list order), `created_at` text
- `blocks`: `id` text PK, `activity_id` text → activities (delete its blocks together with the activity, in one transaction), `day` int 0–6, `start` int, `length` int
- Every column with rules has a `CHECK` constraint for them, generated by drizzle-kit from `check()` in the schema: id lengths, `name` length, the palette hues, `mode`, multiples of 15 and the ranges of `budget_minutes`, `days`, `day`, `start`, `length`, `day_start` and `day_end`. Turso enforces them.
- Every table is `STRICT`, so a column only takes values of its own type. drizzle-kit can't generate `STRICT` yet, so the generated SQL gets it by hand, in `drizzle/<timestamp>_<name>/migration.sql`, and a test fails if any table goes without it (for example after drizzle-kit rebuilds a table in a later migration). A `STRICT` table refuses a `CASE` in a `CHECK`, whose type it can't tell, so checks use `AND` and `OR` instead.
- `settings`: a single row with `day_start`, `day_end`, and `example_loaded_at` (text, ISO 8601, null when there is no example week). The theme isn't stored here (see Data model).

### Writes and undo

- Write when an action is complete: block added, drag or resize finished, keyboard nudge, activity saved. Never write per pointermove. Make one transaction per user action.
- Undo stays in memory, as in the prototype. Applying an undo step writes the restored state back in one transaction.
- The status in the top app bar says whether and where the last change is saved: "Saved in this browser", "Saving…", "Saved in limited storage" (see Progressive enhancement, which includes a database that won't open), or "Not saved". It is a link to Settings › Your data, so every question about the data ("saved how safely?") lands where the answers and actions are: keeping the plan, a broken database, export.
- **The status never shows whether the browser keeps the plan** (see Keeping the data). That's about the future, not the last change, and most browsers don't grant persistent storage to a new site, so it would be a warning for nearly everyone nearly all the time, and "Not saved" would stop standing out. Storage problems that change what happens to a change (limited storage, no storage) do show there. On a write error, show a snackbar that explains what failed, with Retry ("Couldn't save your last change. It's still on screen."), and keep the in-memory state.

### Export, import and reset (required)

Backup works like flashcut's (`src/lib/db-file.ts`, `src/lib/download.ts`, and `exportFile`/`importFile`/`wipe` in `src/db/client.ts`):

- **Export database:** downloads the raw SQLite file as `week-budget-planner-YYYY-MM-DD.db` (`application/vnd.sqlite3`). The leader runs `PRAGMA wal_checkpoint(TRUNCATE)`, briefly closes the database, reads the file bytes from OPFS, then reopens. Calls that arrive in the meantime queue behind the reopen. Export works from any tab.
- **Import database:** the user picks a `.db` file and confirms in a native `<dialog>` ("Replace your plan?") that names the file and how many activities and blocks it replaces, with a link to export first. The leader closes the database, deletes the stale `-wal`, writes the file and makes every tab reload. Run migrations on the imported file at open, so older exports still load.
- **An import never replaces the plan with something that can't be opened.** Before touching the database, the leader checks that the file starts with the SQLite header (the 16 bytes `SQLite format 3\0`), then writes it to a separate file in OPFS (a new name for each try, because the engine keeps a file it failed to open locked until the page reloads; the leader removes leftover copies when it opens the database), opens that copy, runs the migrations on it and reads the plan from it. Only if all of that works does it replace the database. Otherwise the plan stays as it was, the copy is deleted, and the snackbar says: "This file isn't a Week Budget Planner database, so nothing was changed." A `.json` file has to be a plan in the stored format, or the snackbar says: "This file isn't a Week Budget Planner plan, so nothing was changed."
- **A file from a newer version of the app is refused**, since this version can't know what the newer one changed. A `.db` file is newer when Drizzle's table lists a migration this version doesn't have; a `.json` file is newer when its `version` is above 1. Nothing is changed, and the snackbar makes it actionable: "This file is from a newer version of Week Budget Planner. Reload to update the app, then import it again." with the action "Reload".
- **A plan saved by a newer version** (the database lists a migration this version doesn't have, for example after another tab updated the app) is neither opened nor replaced by a fallback. The app shows a full-page state instead: "Your plan was saved by a newer version" with "Reload to update Week Budget Planner. Your plan is safe, and nothing was changed." and a filled "Reload" button. This works in every tab, including tabs that reach the database through the leader.
- **Delete all data:** confirm, delete the database files and reload every tab.
- **While the database is closed** for an export, an import or a delete, calls from every tab wait. After an export they continue on the reopened database. After an import or a delete they never run, because every tab reloads. Nothing may reopen the database in between. An export reopens the database even when reading the file failed.
- Deleting a file that doesn't exist is fine. Any other error deleting or writing a database file fails the action and is shown to the user. It is never ignored.
- **A database that can't be opened isn't hidden.** If the database file exists but fails to open, the app falls back to limited storage (see Progressive enhancement), and Settings › Your data says so in an error-colored notice: "The database in this browser couldn't be opened. So your plan is in limited storage for now. Import a backup, or delete all data to start over." with the buttons "Import backup" and "Delete all data" Delete all data then also deletes the database files. It marks them for deletion in `localStorage` (`week-budget-planner.remove-database`, holding the time it was asked for) and reloads every tab, and the next leader deletes them before it opens anything, since the engine keeps a file it failed to open locked.
- At the limited storage levels (see Progressive enhancement), export and import use a `.json` file of the plan instead. The full app also imports such a `.json` file.
- These live on the Settings page (see Layout), which says that the data lives only in this browser and that export is the backup.

### Keeping the data

Browsers may delete a site's storage when space runs low, unless the site has persistent storage. Safari also deletes storage written by script after 7 days without a visit, unless the site was added to the home screen.

The app asks the user before it asks the browser (see Browser permissions under Security):

- **Ask only once the user has made something worth keeping:** after the first saved change to their own plan (not the first-run save, and not while the example week is shown). Before that it would be noise about an app they haven't learned yet.
- **The ask is a card**, not a snackbar, at the top of the Activities pane (on phones, the Activities screen), in the same place and style as the example-week card: "**Your browser may delete your plan** if it runs low on space. Ask it to keep your plan?" with the buttons "Not now" and "Keep it". It stays until answered, without covering the week or holding up other snackbars, since only one snackbar shows at a time and "Deleted Gym and its 3 blocks · Undo" must never wait. The two cards never show together, because this one only appears once the example week is gone. Show it only if `navigator.storage.persisted()` is false.
- Only "Keep it" calls `navigator.storage.persist()`. Chrome and Safari then decide on their own, and Firefox shows its prompt, which now follows a reason the user just read and a choice they made.
- After "Keep it", the card goes away and a snackbar reports the browser's answer: "This browser will keep your plan.", or "This browser didn't agree to keep your plan. Export now and then to keep a copy." with the action "Export".
- "Not now" stores the time in `localStorage` (`week-budget-planner.keep-plan-dismissed-at`), and the card doesn't come back. Settings still offers it.
- Settings › Your data shows the state from `navigator.storage.persisted()` as its first row, "Keeping your plan", with a shield icon (`verified_user`, `gpp_maybe` or `gpp_bad`). Persisted: "This browser keeps your plan until you delete it." Not persisted: "This browser may delete your plan when it runs low on space. Export now and then to keep a copy." with a "Keep my plan" button that calls `persist()`. If the browser said no (`navigator.permissions.query({ name: "persistent-storage" })` is `denied`), say so instead of offering the button again: "This browser didn't agree to keep your plan. Export now and then to keep a copy."

The design canvas has every state above on its "Your data" board, and the Settings boards show the row in place.

### Calls between tabs

A leader can stop answering without letting go of the lock, for example when the browser freezes a background tab. So while a tab has calls open, it asks every half second whether the leader is still there, and gives up after 10 seconds without any answer. The leader starts answering as soon as it holds the lock, even while its database is still loading, so a slow first download doesn't count as silence. After the time limit the call fails like any failed write ("Couldn't save your last change. It's still on screen."), or, while opening, the app falls back to limited storage. A call that timed out may still have been applied by the leader, so it isn't retried on its own.

### Hosting on GitHub Pages

- The app is a static site on GitHub Pages, deployed by a GitHub Actions workflow that builds with pnpm. It is served from the project path (`/week-budget-planner/`), so set Vite's `base` to it and resolve every URL (the iconset, fonts, the service worker and its scope) against the base.
- **Cross-origin isolation by service worker:** GitHub Pages can't send the COOP and COEP headers, so the app's own service worker (for example `src/sw.ts`, built to `sw.js` at the base) adds them. On every fetch it handles, it returns the response with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` added (and `Cross-Origin-Resource-Policy: same-origin` on same-origin responses). This is the technique of [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker), written as part of our own worker rather than copied in, because a page has one service worker per scope and the later PWA step will extend this same worker.
- **Startup:** a small inline script in `index.html` runs before the app. If `crossOriginIsolated` is false and service workers are available, it registers the worker and, once the worker controls the page, reloads once. A `sessionStorage` flag prevents a reload loop when isolation still fails. The app itself never waits on this: it starts with what it gets (see Progressive enhancement).
- **No cross-origin files:** with `require-corp`, cross-origin files would need CORS or CORP. Self-host everything instead, including Google Sans Flex (SIL Open Font License) as `woff2` under `public/fonts/`, so isolation never breaks a font or an icon.

### Progressive enhancement

The app must still work, to a degree, where storage or isolation is restricted, for example in a private window, with service workers blocked, or in an older browser. Detect what is available at startup and use the best level, without blocking the UI. The planner itself (activities, blocks, budgets, dragging, undo) works the same at every level; only saving differs.

1. **Full:** cross-origin isolated, OPFS and Web Locks available. SQLite database, cross-tab updates, export and import of the `.db` file. Status: "Saved in this browser".
2. **Limited storage:** no isolation (no `SharedArrayBuffer`) or no OPFS, but `localStorage` works. The plan lives in memory and is saved after each change as JSON in `localStorage`, in the stored format of `examples/example-week.json`, sanitized on load. Other tabs pick up changes through the `storage` event (last write wins). Export and import use a `.json` file of the plan instead of `.db`. Status: "Saved in limited storage". Settings › Your data explains: "This browser blocked the full database here, for example in a private window. Your plan is kept in simpler storage that the browser may clear, for example when the window closes. Export to keep a copy."
3. **No storage:** `localStorage` is missing or throws. The plan lives in memory only. Status: "Not saved", plus a one-time banner: "This browser doesn't allow saving here. Your changes are lost when you close this tab. Export to keep them." Export and import of `.json` still work.
4. **No JavaScript:** a `<noscript>` message that the planner needs JavaScript.

Moving up a level later (for example the same browser outside a private window) starts from that level's own storage. Importing a `.json` export into the full app works too, so a plan made in a private window can be carried over.

### Also keep

- Sanitize values read from the database, especially after an import.
- "Load an example week" from `examples/example-week.json` (bundle it), with `exampleLoadedAt` set to the time it was loaded. Offer it in the empty state. "Keep these" and "Start empty" set it back to null.

## Security

There is no backend and no account, but the plan is the user's own data, and an imported file is untrusted input. The page carries a Content Security Policy that blocks any script it didn't ship, and Trusted Types, so nothing can write a string as HTML unless the build put it on an allowlist. That second part also stops us from adding a way to write untrusted HTML by mistake later.

**Content Security Policy.** GitHub Pages can't send headers, so the policy is a `<meta http-equiv="Content-Security-Policy">` that the build adds as the first element of `<head>` (`vite-plugins/content-security-policy.ts`), in front of the inline scripts:

```
default-src 'self';
script-src 'self' 'sha256-…' 'sha256-…' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
object-src 'none';
base-uri 'none';
form-action 'self';
require-trusted-types-for 'script';
trusted-types default service-worker
```

- The hashes are of the two inline scripts in `index.html` (the theme and the service worker registration), computed by the build, so editing them never needs a manual hash update.
- `'wasm-unsafe-eval'` lets the database engine compile its WebAssembly. Nothing may use `eval`.
- Styles allow `'unsafe-inline'`, because inline `style` attributes are part of Solid templates and the icon sprite, and the Trusted Types guard already covers injected markup.
- `frame-ancestors` doesn't work in a `<meta>` policy. The service worker adds it as a header to the page, together with the companion headers below, and `public/_headers` sends the same for hosts that read it.
- **Companion headers:** `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- In development, Vite sends the Trusted Types part as `Content-Security-Policy-Report-Only`, so a mistake shows up as a violation in the console without breaking Vite's own error overlay. The full policy is enforced in `pnpm preview` and in production.

**Trusted Types.** With `require-trusted-types-for 'script'`, the browser refuses plain strings at every place where a string turns into HTML or code (`innerHTML`, `insertAdjacentHTML`, `outerHTML`, `DOMParser`, `eval`, `new Worker(url)`, `serviceWorker.register(url)` and the like). Only values made by an allowed policy pass. There are two policies:

- **`default`** (`src/trusted-html.ts`, imported first by `src/index.tsx`). The browser calls it for every plain string at those places.
  - **HTML:** only exact strings on the allowlist pass. The build puts every template the Solid compiler produced on it: Solid builds the DOM from static template strings (`template()` in `@solidjs/web`, its only HTML sink), and the plugin reads them from the compiled code and registers them with the module that uses them. The icon sprite is on the list too. Anything else, for example a JSX `innerHTML={…}` with a string, or `insertAdjacentHTML` with an activity name, is refused with a Trusted Types violation.
  - **Script URLs:** only same-origin URLs, which covers the database worker.
  - **Scripts:** none.
- **`service-worker`** (the inline registration script): returns the one service worker URL, whatever it's given.
- `allowHtml()` is only for the build. The plugin fails the build when any other file imports `src/trusted-html.ts`, except `src/index.tsx`, which only imports it.
- **One violation per page load is expected:** emnapi, which the database engine is built on, checks once whether `new Function` works and falls back to plain functions when it doesn't. That check shows up as a `TrustedScript` error in the console (in development, as several report-only messages). Any other violation is a bug.
- To show user text, use text: JSX children and attributes, `textContent`. If a feature ever needs real untrusted HTML, it needs the Sanitizer API (`setHTML()`) and a decision recorded here first.

### Browser permissions

Never trigger a browser permission prompt the user has no context for. This covers persistent storage today, and location, camera, microphone, notifications and the like if a feature ever needs them.

- **The app asks first, in its own UI,** saying in plain words what the permission is for, right where it matters, with a button for the user to agree. Only that button calls the browser API (`navigator.storage.persist()`, `getCurrentPosition()`, `getUserMedia()` and so on). Never call it on page load or as a side effect of something else.
- "Not now" is respected: store when it was dismissed and don't ask again on your own. Keep a way to agree later in Settings.
- Check the state first with `navigator.permissions.query()` where the permission is listed there. Don't ask for what's already granted. When it's denied, explain how to change it in the browser instead of asking again.
- Where Chrome's `<permission>` element supports the permission (location, camera, microphone), prefer it inside our explanation, with a plain button calling the API as the fallback. It only prompts on the user's click.
- A feature that needs camera, microphone or location also has to loosen the `Permissions-Policy` header, which turns them off today.

## Design

The app follows **[Material 3 Expressive](https://m3.material.io/blog/building-with-m3-expressive)**, Google's 2025 update of Material Design 3. Build it with plain CSS from the tokens in `docs/design/m3-tokens.css`, without a component library.

**Expressiveness is a goal, not decoration.** The app should feel playful and personal, with some whimsy, which is what Material 3 Expressive is about: bold shapes, lively color, emphasized type and springy motion. A planner can feel like a chore, and this one should feel like yours. When choosing between a plain and an expressive option that Google's guidance allows, lean expressive, for example shapes for activities, shape changes on selection and spring motion. Keep the week grid calm and readable, though: expressiveness must never add clutter or cost legibility, and it never overrides accessibility.

**Google is the only source for Material Design:** m3.material.io, the [Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit) in Figma, and Google's own code. Third-party implementations and write-ups are not sources. Only the user can approve a deviation from Google's guidance, and approved deviations are listed under "Deviations" below. The [design canvas](https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk) shows every screen and state.

- **Token sources:** shape, type, motion and component sizes come from Google's own Material 3 tokens ([androidx `material3/tokens`](https://github.com/androidx/androidx/tree/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens)). Colors come from [material-color-utilities](https://github.com/material-foundation/material-color-utilities). Regenerate them from there rather than inventing values.
- **Color:** a `SchemeTonalSpot` light and dark scheme from the seed `#3a5bd9` (a cobalt close to the prototype's accent). Pages sit on `surface-container`, and panes, lists and the grid use a card color (`surface-container-lowest` in light, `surface-container-high` in dark). Over budget uses `error`, and "All placed" uses a green.
- **Theme:** every color token is `light-dark(light, dark)` on `:root`, with `color-scheme: light dark`, so it follows the system setting by default. The Settings choice sets the content of `<meta name="color-scheme">` to `light` or `dark` (System sets it back to `light dark`), and the tokens map that meta back onto `color-scheme` with `:root:has(> head > meta[name="color-scheme"][content="dark"])`, so CSS doesn't depend on script. A small inline script right after the meta (not a module, not deferred) applies the stored choice before the first paint, so the theme never flashes. Native form controls follow the same switch. Other tabs follow through the `storage` event. Don't clear a stored choice when the system setting happens to change to match it.
- **Activity colors:** the 8 palette hues, keyed by the stored `hue` value: Blue 255, Red 28, Green 152, Amber 78, Violet 305, Teal 198, Pink 350, Lime 118. Each gets a tonal palette (`TonalPalette.fromHueAndChroma(hue, 48)`):
  - block background: tone 90 light, 30 dark
  - block text: tone 10 light, 90 dark
  - solid (swatch, progress, drag chip): tone 40 light, 80 dark
- **Activity shapes:** each activity has a shape from Google's Material 3 Expressive shape library as well as a color. Shape and color are independent, so activities can be told apart without relying on color (for example with color blindness) and there are 35 × 8 = 280 combinations. The swatch is the activity's solid color in its shape. It appears in the Activities list, the placing toolbar, the Add block chooser, the pickers and, small, on blocks (see Grid geometry).
  - The shapes are CSS `shape()` values in `docs/design/m3-shapes.css`, generated by `pnpm shapes` (`scripts/build-shapes.ts`) from Google's own `MaterialShapes.kt` and graphics-shapes code at a pinned androidx commit. Apply one by setting `--activity-shape: var(--shape-<name>)` on the activity's element; `.swatch` clips to it. Don't redraw the shapes or use SVGs.
  - **Pickers:** the color picker shows each color in the activity's current shape, and the shape picker shows every shape in the current color. The selected item sits on a tonal rounded square with a `primary` ring.
  - **Defaults:** a new activity gets a color and a shape that no other activity uses yet when possible, chosen from its id so the choice is stable and reproducible. Compute `h`, the 32-bit FNV-1a hash of the id's UTF-8 bytes. The color is the first palette color, starting at index `h % 8` and wrapping, that no other activity uses; if all are used, the one at `h % 8`. The shape is the first entry of the default shape list, starting at index `(h >>> 8) % 30` and wrapping, that no other activity uses; if all are used, the one at that index. The default shape list leaves out shapes that are hard to tell apart when small (cookie 7, boom, soft boom, pixel circle, pixel triangle) and is ordered so neighbours look different: circle, heart, triangle, cookie-4, arch, clover-4, diamond, sunny, pill, gem, fan, cookie-6, slanted, flower, pentagon, burst, semi-circle, clover-8, arrow, puffy, square, cookie-9, ghostish, soft-burst, oval, very-sunny, clam-shell, puffy-diamond, bun, cookie-12. The defaults are stored with the activity, so later changes to other activities never change them. The user can still pick any of the 35 shapes.
- **Type:** Google Sans Flex (variable, from Google Fonts) on the M3 type scale, with the emphasized styles for headings and figures. App bar headlines are the page's name in plain Title Large.
  - **Loading:** self-hosted in `src/font/`, Latin only, trimmed to the axes the app uses. The page renders with a 49 KB copy (weights 400 to 700 and `ROND`), preloaded from `index.html` with `crossorigin`. After the `load` event, a 121 KB copy that adds the optical size axis (`opsz`) is loaded with the Font Loading API and replaces it, so the first paint never waits for the larger file. The swap keeps line heights, but small text gets slightly wider and can rewrap a long line once. `font-size-adjust: from-font` keeps the fallback font's x-height the same until the font arrives. Use tabular numerals for times and figures. There is no monospace font.
- **Icons:** Material Symbols Rounded (weight 400, grade 0, 24px), as the official SVGs from Google's [`google/material-design-icons`](https://github.com/google/material-design-icons) repository, not the icon font. `icons/icons.json` lists the icons and pins the repository commit. Its `brands` list adds the only other icon, GitHub's mark, from GitHub's own [Octicons](https://github.com/primer/octicons) at a pinned commit (see Deviations). `pnpm icons:fetch` downloads missing SVGs into `icons/material-symbols/`, and `pnpm icons` optimizes them with SVGO and combines them into `src/icons/iconset.svg`, with one `<symbol>` per icon filled with `currentColor`. The sprite is bundled into the script, not loaded as a file: import it with `import iconset from "./icons/iconset.svg?raw"` and insert it once at startup with `document.body.insertAdjacentHTML("afterbegin", iconset)`. Its root `<svg>` is `aria-hidden` and `display: none` (the `hidden` attribute doesn't hide an `<svg>`). Icons then render with the first frame, with no extra request, and the sprite is versioned with the script bundle (3.9 KB gzipped). A preload can't replace this: `<use>` fetches in `same-origin` mode, which no preload matches, so Chromium downloads the file twice or warns about an unused preload. Show an icon with `<svg class="icon" aria-hidden="true"><use href="#undo"/></svg>` (`#name-fill` for the filled variant). Name icon-only buttons with visually hidden text inside the button (`<span class="visually-hidden">Undo</span>`), not `aria-label`: it's the native naming mechanism, and translation tools translate it. Icons take the text color of the element they sit in, so color them with `color`, using the same role as the text next to them (for example `on-surface-variant`, `error` or `on-secondary-container`).
- **Shape:** the M3 corner scale (4, 8, 12, 16, 20, 28, 32, 48 and full). Buttons are fully round. Panes, the grid and dialogs use 28. Grouped lists have 20px outer and 4px inner corners with 2px gaps. Blocks use 8 (12 when selected, 4 when 15 minutes long).
- **App bar:** Google's small app bar (androidx `AppBarSmallTokens`): 64dp tall, the headline in Title Large 16dp from the leading edge, at most two trailing icon buttons with 4dp after the last one, and no overflow menu. It starts the color of the page (`surface-container`) and fills with `surface-container-high` once the content scrolls under it, since Google's on-scroll color (`surface-container`) is our page color.
- **Components:** small top app bar, navigation bar (64px, active indicator), navigation rail (collapsed, 96dp), FAB (56dp), connected button groups, filled, tonal, outlined and text buttons, extended FAB, menu, modal bottom sheet, dialog, snackbar, outlined text fields, linear progress indicator with a gap and a stop dot, and a floating toolbar (vibrant, 64px, fully round) for placing.
- **Progress over budget:** a progress indicator spans whichever is larger, the budget or what's placed. Within budget it is Google's linear progress indicator: the filled part, a gap, the rest of the track and the stop dot. When an activity is over budget, the bar splits at the budget mark: the within-budget part in the activity's color, the usual 4px gap, then the overrun in red (`--over-budget`: the error palette's tone 40 in light, the scheme's `error`, and tone 60 in dark, because the dark `error` is a pale pink that doesn't read as red), sized in proportion (12 h budget with 12 h 30 min placed: 96% and 4%). The overrun is at least 4px wide so small overruns stay visible. The "over budget" text stays, so the bar never carries the meaning by color alone. The week summary's overall bar follows the same rule when the total placed is over the total budget.
- **Wavy progress while resizing:** while a pointer drag changes an activity's placed time (resizing a block, or dragging a new block in from the Activities list), that activity's progress indicator switches to Google's wavy linear progress indicator, and so does the week summary's. Its width follows the drag live. On release the wave flattens and the bar settles at its new ratio. Moving a block doesn't change placed time, so it doesn't make the bar wavy. Keyboard changes and undo just settle the width without a wave.
  - Values from Google's tokens (`LinearProgressIndicatorTokens`, `WavyProgressIndicator.kt`): wave amplitude 3dp, wavelength 40dp, indicator and track 4dp thick, container 10dp tall, and the wave travels one wavelength per second. The amplitude grows over 500ms with the standard easing `cubic-bezier(0.2, 0, 0, 1)` and shrinks over 500ms with the emphasized accelerate easing `cubic-bezier(0.3, 0, 0.8, 0.15)`.
  - Google's default amplitude is zero below 10% and above 95% progress. While resizing we keep the full amplitude across the whole range (an allowed setting of the component), so the wave shows even near "All placed". Over budget, the within-budget part and the overrun both wave.
  - Every progress indicator reserves the 10dp container height, flat or wavy, so rows don't jump when it switches.
  - Draw the wave with `clip-path: shape()`, built in script from the current amplitude, phase and width, and update it inside the drag's `requestAnimationFrame`. With `prefers-reduced-motion`, skip the wave and the travel: the bar stays flat and only its width changes.
- **Blocks** are solid tonal fills with no border or side rail. The selected block gets a 2px `primary` ring with a gap, plus elevation.
- **Motion:** M3 Expressive uses springs. Approximate the spatial and effects springs with CSS `linear()` easing curves. Respect `prefers-reduced-motion` by dropping spatial motion and keeping only fades and the progress widths.
- **Touch targets** are at least 3rem (2.5rem visual buttons with padding around them).
- **Text size and zoom (WCAG 1.4.4 Resize Text, 1.4.10 Reflow):** Avoid px. Google's sp and dp values become rem (divided by 16, so 16dp = 1rem), so text, spacing, corners and controls follow the user's preferred text size, not only browser zoom. `index.html` opts into the operating system's text size with `<meta name="text-scale" content="scale">`. Never set a font size on `:root` or `html`. Only 1–2px hairlines stay in px: borders, outlines, grid lines, the 1px shadow offsets and selection rings. Controls that hold text use a minimum height and grow with their text instead of clipping it. Breakpoints use `em` (the wide layout starts at 52.5em, Material's 840dp at the default size), so larger text switches to the phone layout sooner. Check text at 200% and reflow at a 320 CSS px wide viewport.
- **Accessibility:**
  - Every interactive element shows a focus ring on `:focus-visible` (an outline with an offset, in `primary`), never on plain `:focus`.
  - Windows High Contrast (`forced-colors: active`): the browser drops box shadows and replaces backgrounds, so selection rings fall back to an `outline` in `Highlight`, blocks get a border, the progress indicator uses system colors, and the activity swatches keep their color with `forced-color-adjust: none`, since the color is the information there.
  - Snackbars and the save status are announced through one shared polite live region (`role="status"`). A failed write is announced as an alert. "Saving…" isn't announced.
  - The reset removes list styles, which makes Safari drop list semantics, so the Activities list and other real lists get `role="list"`.
  - Text fields show focus and errors from the platform state (`:focus-within`, `:user-invalid`), not from script.
- **CSS layers:** styles live in cascade layers declared up front, lowest priority first: `@layer reset, base, theme, components, utilities;`. `reset` removes browser defaults with element selectors only, never a global `*` rule. `base` is the document's font, colors and links. `theme` holds the design tokens as custom properties, including the shapes, which `m3-shapes.css` declares in that layer itself. `components` holds Material's components and the app's own. `utilities` holds single-purpose classes that combine with any component: the type roles, `.muted`, `.brand` and the activity colors. A later layer always wins, so no selector needs extra specificity to beat an earlier one. Use `:where()` inside a layer for defaults that should be easy to override.
- **Names:** whole words, no abbreviations, in CSS as in code: `.button`, not `.btn`; `--corner-extra-small`, not `--corner-xs`. Use Material's own name for a part when it has one (`.top-app-bar`, `.active-indicator`, `.drag-handle`, `.title-medium`). Only very common abbreviations such as UUID, URL or ID are fine.

### Deviations

Every deviation from Google's guidance needs the user's approval before it is built. Approved so far:

- **Over-budget progress** (approved 2026-10): Google's linear progress indicator has no over state. Ours splits the filled part into a within-budget part and an overrun part in `error`, separated by the indicator's own gap (see "Progress over budget" above). In dark mode the overrun uses the error palette's tone 60 instead of the scheme's `error` (tone 80) so it reads as red.
- **GitHub mark** (approved 2026-10): Material Symbols has no brand icons, so the About section's version item, which opens the repository on GitHub, starts with GitHub's own mark from Octicons instead. It sits in the iconset like the Material icons and takes the text color, with 2 units of padding around its 24-unit drawing so it matches Material's drawn area. It's the only icon not from Material Symbols, and GitHub's logo guidelines allow it for linking to GitHub.

### To check against Google

The design canvas made these choices without a Google source. Confirm each against m3.material.io or the Figma kit, and if Google says otherwise, follow Google or ask the user to approve a deviation:

- The grouped list (20px outer corners, 4px inner corners, 2px gaps). These values came from looking at Android's settings, not from a Google spec.
- The activity color palettes at chroma 48. M3's guidance for extra, custom colors may prescribe something else, such as harmonizing them with the scheme.
- Block shapes (8px, 12px when selected, 4px at 15 minutes) and the selected ring.
- The size and placement of the shape on blocks, and the pickers' selected style.
- Google Sans Flex as the typeface. Google's baseline type tokens use the system sans-serif (Roboto on Android).
- Approximating the springs with CSS `linear()` easing.
- The focus ring (2px outline in `primary`, 2px offset). Look up Material's focus indicator.
- In-place prompts as cards (the example-week card, the keep-your-plan card). Material 2 had a banner component for persistent, nonmodal messages. Material 3's code (androidx `material3`, Material Components for Android) has none, but m3.material.io couldn't be checked. If M3 recommends a pattern for this, use it.

Screenshots of the old prototype are in `docs/`. They show the earlier look, not the target design.

## Dates, times and language

Dates and times use **Temporal**, never `Date`. The plan itself has no dates: block times are integer minutes in a Monday-to-Sunday week. Dates only show up at the edges:

- Times that are stored, such as `exampleLoadedAt` and an activity's `created_at` in the database, are `Temporal.Now.instant().toString()`, an ISO 8601 time in UTC. Reading them back uses `Temporal.Instant.from()`, and anything that doesn't parse becomes null.
- Export file names use today's local date, `Temporal.Now.plainDateISO()` ("week-budget-planner-2026-10-17.json").
- Formatting a week minute goes through `Temporal.PlainTime` (and a reference Monday, `Temporal.PlainDate`, for weekdays), because `Intl.DateTimeFormat` formats Temporal values directly.

Everything the user reads is **formatted by `Intl`**, never assembled by hand, so it follows the user's language and conventions. With no setting, that is the browser's language (`navigator.languages`). The copy in this spec writes lengths as "1 h 30 min" and times as "07:30" for readability. The app shows whatever `Intl` gives, for example:

| What | API | en-GB | en-US | de |
| --- | --- | --- | --- | --- |
| Lengths and budgets in text ("left to place", the budget line, the placing toolbar) | `Intl.DurationFormat`, `style: "short"` | 1 hr, 30 mins | 1 hr, 30 min | 1 Std., 30 Min. |
| Lengths on blocks and day totals | `Intl.DurationFormat`, `style: "narrow"` | 1h 30m | 1h 30m | 1 Std., 30 Min. |
| Clock times (the gutter, day hours, snackbars) | `Intl.DateTimeFormat`, `timeStyle: "short"` | 07:30 | 7:30 AM | 07:30 |
| A block's time range | `formatRange()` of the same formatter | 10:00–11:30 | 10:00 – 11:30 AM | 10:00–11:30 Uhr |
| Weekdays | `Intl.DateTimeFormat`, `weekday: "short"` or `"long"` | Mon, Monday | Mon, Monday | Mo, Montag |

- A length of zero would format as an empty string, so it shows its minutes (`minutesDisplay: "always"`): "0 min".
- An overnight block's range puts the weekday before each end: "Tue 22:00 – Wed 02:00". `formatRange()` would add the day of the month, which a week without dates doesn't have.
- Creating an `Intl` formatter is slow, and the grid formats on every drag frame, so formatters are created once per set of options and reused.
- Every formatting function takes the format options as a parameter (see below), so a setting can change them without touching the callers.

**Format settings (later).** The app may become a calendar app, and calendar apps let people choose their formats apart from their language, for example English with a 24-hour clock and weeks starting on Monday. Plan for these settings, each with "System" as the default: the language, the time format (12-hour or 24-hour, `hourCycle: "h12"` or `"h23"`) and the first day of the week (`Intl.Locale.prototype.getWeekInfo()` gives the system's). For now the week always starts on Monday, as the data model says. They'd be device preferences in `localStorage`, like the theme.

**Translations (later).** The copy is English only for now, written as plain strings next to where it's used. When the app is translated, use Mozilla's [Fluent](https://projectfluent.org/) (`@fluent/bundle`, with `@fluent/dom` or a small Solid binding): one `.ftl` file per language, loaded with a dynamic `import()` for the language in use. Fluent's plurals and number formatting come from `Intl` as well, and it has a Rust implementation (`fluent-rs`), as nanoid does. An alternative from a standards body is Unicode MessageFormat 2 (the `messageformat` package, and the basis of the proposed `Intl.MessageFormat`). Decide between the two when translations start.

## Browser support

This is a cutting-edge app, built first for its author's own up-to-date browsers. Baseline Newly available features are fine to use. Where a fallback exists and is cheap, use it. Where there is none, or it isn't worth its code, list the feature here so it's a known gap, not a surprise. Polyfills are loaded only when feature detection says they're needed (see `docs/LOADING.md` for where everything loads), and never in the initial bundle: each one comes in through a dynamic `import()`, which Vite splits into its own chunk, so browsers that don't need it never download it. Check the build output to confirm the chunk is separate. Versions are from MDN's browser compat data.

**With a fallback, or degrading on purpose:**

| Feature | Supported from | Without it |
| --- | --- | --- |
| SQLite in OPFS (`createSyncAccessHandle`), Web Locks, BroadcastChannel, cross-origin isolation | Chrome 102, Firefox 111, Safari 15.4 | The lower storage levels (see Progressive enhancement). |
| `<meta name="text-scale">` | Chrome 146 | Ignored. Browser text size and zoom still work. |
| View Transitions | Chrome 111, Firefox 144, Safari 18 | Changes apply without the animation. |
| `clip-path: shape()` for the wavy progress bar | Chrome 135, Firefox 148, Safari 18.4 | The bar stays flat. |
| `forced-colors` rules, `forced-color-adjust`, `Mark` | Chrome, Firefox (Windows High Contrast) | Not needed where forced colors don't exist. |
| Translucent colors | `color-mix()`: Chrome 111, Firefox 113, Safari 16.2 | Used instead of the relative color syntax (`rgb(from …)`, Safari 18), with the same result. |
| `light-dark()` in every color token | Chrome 123, Firefox 120, Safari 17.5 | Light mode only: an `@supports not` block in the tokens gives every color its light value (a test checks they match), and the theme setting has no effect. |
| `clip-path: shape()` for activity shapes | Chrome 135, Firefox 148, Safari 18.4 | Every swatch is a circle, so activities differ by color only, and the shape picker shows circles. |
| Popover API for the menus, the placing toolbar and snackbars | Chrome 114, Firefox 125, Safari 17 | OddBird's [`@oddbird/popover-polyfill`](https://github.com/oddbird/popover-polyfill), loaded only when `"popover" in HTMLElement.prototype` is false. It can't add the real `:popover-open` pseudo-class and sets a `.\:popover-open` class instead, so popover rules must match both with `:is(:popover-open, .\:popover-open)`, or older browsers drop the whole rule. |
| Temporal, for dates and times | Chrome 144, Firefox 139, not yet in Safari | FullCalendar's [`temporal-polyfill`](https://github.com/fullcalendar/temporal-polyfill) (MIT, 20 KB gzipped), loaded with a dynamic `import()` only when `globalThis.Temporal` is missing, and awaited before the app renders. Chosen over the proposal champions' `@js-temporal/polyfill`, whose README doesn't call it ready for production yet, and which is 47 KB gzipped. |
| `Intl.DurationFormat`, for lengths | Chrome 129, Firefox 136, Safari 16.4 | FormatJS's [`@formatjs/intl-durationformat`](https://formatjs.github.io/docs/polyfills/intl-durationformat) (MIT, 18 KB gzipped), loaded the same way when `Intl.DurationFormat` is missing. It uses the browser's `Intl.NumberFormat` for the units, so it needs no locale data. |
| Trusted Types | Chrome 83, Firefox 148, Safari 26 | Not enforced: the page works the same, without the guard. Development in any current browser still catches mistakes. |
| Anchor positioning for the add-block menu | Chrome 125, Firefox 147, Safari 26 | OddBird's [`@oddbird/css-anchor-positioning`](https://github.com/oddbird/css-anchor-positioning) polyfill, loaded with a dynamic `import()` only when `"anchorName" in document.documentElement.style` is false, so other browsers never download it. It needs an explicit `anchor-name` on the slot (no implicit anchors) and `anchor()` insets instead of `position-area` on the popover. Check whether it has to run again when the menu moves to another slot. |

Everything else in use is older than these: cascade layers, `:has()`, `:user-invalid`, `color-mix()`, `linear()` easing, `<dialog>` and `@starting-style`. So the full look needs Chrome 135, Firefox 148 or Safari 18.4. Below that, shapes become circles, and below Chrome 123, Firefox 120 or Safari 17.5 the app is light only. With the polyfills, the floor is set by `:user-invalid` and `:has()`: about Chrome 119, Firefox 121 and Safari 16.5. `@starting-style` only animates, so without it things appear without a transition.

## Ideas for later (not in the prototype)

**Long-term direction, not in scope now:** the app may grow into a calendar app, with week planning by budget staying its core and what sets it apart. The likely order: finish the week planner, then export the week as an `.ics` file (one weekly repeating event per block, using block ids as stable event ids), then import other calendars as a read-only background layer, then per-week variants for irregular blocks. Full calendar features (dated events, invites, two-way sync) would come last, if ever. Don't build toward this yet, but avoid choices that block it, such as unstable block ids.

- Several weeks or semesters, per-week variants (exam week, A/B weeks), or real calendar dates
- Exporting to iCal or Google Calendar (`.ics` file)
- Importing other calendars as a read-only background layer
- Fixed blocks such as lectures that are locked in place
- A picture inside an activity's shape instead of a color
- Sync across devices (for example Turso sync, since the database is already Turso)
- Format settings and translations (see Dates, times and language)
- Installing as a PWA, like flashcut (its Workbox config raises the precache size limit for the large WASM file)
