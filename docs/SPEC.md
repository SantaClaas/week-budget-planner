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
| **Activity** | Something you budget time for, like a class, your job or the gym. It has a name, a color and a budget. | Code: `Activity` |
| **Budget** | How many hours an activity needs, counted per week ("4 h per week") or per day on a number of days ("1 h 30 min per day, 3 days"). | Code: `mode`, `mins`, `days` |
| **Block** | One piece of an activity on the week: a day, a start time and a length. You add, move, resize and remove blocks. | Was "tile" in the prototype. Code: `Block` |
| **Slot** | A 15-minute cell on the week. An empty slot has no block. Blocks start and end on slots. | Everything snaps to 15 min |
| **Length** | How long a block is. | Code: `dur` |
| **Default length** | The length a new block gets: the per-day budget for per-day activities, otherwise 1 h 30 min, and never more than what is left. | |
| **Placed** | The total length of an activity's blocks. | |
| **Left to place** | Budget minus placed. At zero it reads "All placed". Below zero it is "Over budget". | |
| **Placing** | The mode you are in after picking an activity: every click or tap on an empty slot adds a block of it, until you press Done or nothing is left. | Was "armed" in the prototype |
| **Add block** | Click or tap an empty slot when you are not placing, then choose the activity. | Phone: a bottom sheet. Desktop: a menu |
| **First free slot** | The earliest gap that fits the default length, scanning Monday to Sunday. | |
| **Hours shown** | The part of the day the week shows, by default 07:00 to 22:00. It grows by itself so no block is hidden. | Code: `dayStart`, `dayEnd` |
| **Example week** | Sample activities and blocks shown on first run, until you keep them or start empty. | |
| **Export / Import** | Save the whole database as a `.db` file, or replace this browser's data with one. | Settings › Your data |

Words not to use in the app: **tile** (say "block"), **ledger** (it's the "Activities" list), **arm / armed** (say "placing"), and **event, appointment, task, session** (they suggest dates or to-dos, and this is one reusable week). Code may keep internal names that aren't user-facing, but prefer the glossary terms for new code.

## Changes from the prototype

These were decided after the prototype and override it:

- **Material 3 Expressive** replaces the prototype's look (see Design). The interaction model stays the same unless listed here.
- **"Tile" is renamed "block"** and **"armed" is renamed "placing"** everywhere, including copy such as "Deleted Gym and its 3 blocks."
- **Add block from an empty slot.** Clicking or tapping an empty slot while not placing opens a chooser to add a block there. This is the main touch path, since dragging is hard on phones (see Interactions).
- **Phones use a navigation bar** with Week, Activities and Settings instead of stacking the panes.
- **Settings is a page**, holding the theme choice and the data actions (export, import, delete). The theme choice (System, Light, Dark) is new.
- **The new-activity form** is behind a "New activity" button once at least one activity exists. In the empty state it is shown open.

## Data model

One plan document per user. The stored shape is the same as `examples/example-week.json`:

```ts
type Plan = {
  v: 1;
  activities: Activity[];
  blocks: Block[];        // the blocks on the week
  dayStart: number;       // first hour shown, 0..12 (default 7)
  dayEnd: number;         // last hour shown, 13..24 (default 22)
  example: boolean;       // true while the example week is loaded and not yet dismissed
};

type Activity = {
  id: string;
  name: string;           // max 60 chars
  hue: number;            // one of the 8 palette hues, see Design
  mode: "week" | "day";   // how the budget is counted
  mins: number;           // budget in minutes, per week or per day; multiple of 15, min 15
  days: number;           // 1..7, used only when mode === "day"
};

type Block = {
  id: string;
  act: string;            // Activity.id
  day: number;            // 0 = Monday … 6 = Sunday
  start: number;          // minutes from midnight, multiple of 15
  dur: number;            // length in minutes, multiple of 15, min 15
};
```

Time is stored as integer minutes and everything snaps to 15 minutes. Weekly budget: `target(a) = a.mode === "day" ? a.mins * a.days : a.mins`. Placed: the sum of `dur` over that activity's blocks. Left to place: `target − placed`. It can go negative, which means over budget.

Sanitize every loaded plan (from storage or sync): clamp numbers, snap to 15, drop blocks whose activity no longer exists, and de-duplicate ids. The prototype's `sanitize()` is the reference.

The theme choice is a device preference, not part of the plan: store it in the `settings` table (see Persistence) as `system`, `light` or `dark`, default `system`.

## Layout

### Wide screens (desktop and tablets, 840px and up)

- **Top app bar:** the app name, the save status ("Saved in this browser", "Saving…", "Not saved"), an Undo icon button and a Settings icon button.
- **Left pane, Activities** (360px wide, scrolls on its own):
  - The example-week card, shown only while `example` is true: "This is an example week. Change it, or start with an empty one." with "Keep these" and "Start empty".
  - A header, "Activities", with the total left to place.
  - The activity list. Each item has a color swatch, the name, the budget line ("4 h 30 min per week" or "1 h 30 min per day, 3 days"), the remaining figure on the right ("1 h 30 min / left to place", "All placed / 3 h", or "30 min / over budget"), a progress indicator, and an Edit icon button.
  - A hint line: "Drag an activity onto the week, or click an empty slot to add a block there."
  - A "New activity" button that opens the form: name, hours (step 0.25), counted per week or per day, days (shown only for per day), and a color picker with 8 colors.
- **Right pane, the week:**
  - A summary ("20 h placed of 32 h · 12 h left to place") with an overall progress indicator.
  - Tools: an "Hours shown" button (opens a menu with the two hour selects, for example "07:00 – 22:00") and "Clear week".
  - The grid. It has a sticky day header row (day name plus the total placed that day), a sticky hour gutter on the left, and 7 day columns. Columns are at least 6rem wide and the grid scrolls horizontally if needed. Weekend columns are slightly tinted, and today's weekday is marked in the header.
- **Floating:** the placing toolbar and snackbars (see Interactions), at the bottom center.

### Phones (under 840px)

- **Navigation bar** (64px) at the bottom with three destinations: **Week**, **Activities**, **Settings**.
- **Week:** a top app bar with the title "Week", Undo and an overflow menu, then the summary and progress, then the grid filling the rest of the screen. About three days fit across, the next one is just visible at the edge, and the grid scrolls sideways with scroll snapping per day. The placing toolbar floats above the navigation bar.
- **Activities:** the same list as the wide-screen pane, with an extended "New activity" floating action button. Tapping an activity starts placing it and switches to Week.
- **Settings:** the same page as on wide screens. On phones it also holds "Hours shown" and "Clear week", which on wide screens sit above the grid.

### Settings page

- **Appearance:** Theme, as a connected button group: System, Light, Dark.
- **Week** (phones only): Hours shown, Clear week.
- **Your data:** "Your plan is stored only in this browser. Nothing is uploaded. Export it to keep a backup or to move it to another device." Then Export database, Import database, and Delete all data (in the error color).
- **Storage:** number of activities, number of blocks, database size.
- On wide screens it is a full page with a back button to the week.

## Grid geometry

- 48px per hour, so 12px per 15 minutes. The hour lines are solid and the half-hour lines are fainter.
- The visible range is `[min(dayStart, earliest block hour), max(dayEnd, latest block end hour)]`. The grid widens itself so a block is never hidden. Don't change the range in the middle of a drag.
- Overlapping blocks in a day sit side by side in lanes, like a standard calendar. Group blocks that overlap, then give each one the first lane whose last end is at or before its start.
- Block content: the name, then the time range and length ("10:00–11:30 · 1h30"). The length can wrap to its own line. Blocks of 30 minutes or less show a single line, "Name · 30m". A 15-minute block has no top resize handle.

## Interactions

All of these must work with a mouse, touch and the keyboard.

**Adding blocks**
- **Drag from the Activities list** (mouse or pen): a press on an activity followed by more than 4px of movement starts a drag. A chip follows the pointer, and a dashed preview shows where the block will land. Dropping on a day creates the block. The start is the slot under the pointer, clamped to the visible range.
- **Placing:** clicking or tapping an activity starts placing it. The placing toolbar appears: "Placing **Gym** · 1 h 30 min. Click a time slot." ("Tap a slot" on touch) with the activity's left-to-place figure, "Use first free slot" and "Done". While placing, a mouse hovering over the grid shows the preview, and each click or tap on an empty slot adds a block of the default length there. Placing stops on its own once that activity is all placed. Escape and Done also stop it.
- **Add block from an empty slot:** when not placing, clicking or tapping an empty slot highlights it and opens a chooser titled "Add block" with the day and start ("Tuesday · from 10:00"):
  - On phones it is a modal bottom sheet. On wide screens it is a menu anchored to the slot.
  - It lists the activities, those with the most left to place first. Activities that are all placed or over budget come last, dimmed but still selectable ("this would go over budget").
  - The phone sheet has a length stepper (− and +, 15 minutes per step), preset to the default length of the activity under focus. The desktop menu uses the default length, and the block can be resized afterwards.
  - It ends with "New activity…", which opens the new-activity form and then adds the block.
  - Choosing an activity adds the block, closes the chooser and shows a snackbar: "Added Gym · Tue 10:00–11:30" with Undo.
  - On touch, a tap on an empty slot must not fire while the user scrolls. Only a tap without movement opens the chooser.
- **First free slot:** scan the days in order, in 15-minute steps within the visible range, for a gap of the default length. For per-day activities, try days that don't have the activity yet first. If nothing fits, show a snackbar ("No free 1 h 30 min slot between 07:00 and 22:00.").
- **Default length:** for per-day activities it's `mins`. For weekly ones it's 90 minutes (one lecture slot). Cap it at the remaining budget when some is left, and at the visible range. The minimum is 15.

**Editing blocks**
- **Move:** drag the block body, which can cross days. Keep the grab offset so the block doesn't jump. Snap to 15 and clamp to the visible range.
- **Resize:** drag the top or bottom handle (7px tall, 4px on short blocks). The minimum is 15 minutes. The top handle keeps the end fixed.
- **Select:** a mouse press selects. On touch, the first tap only selects, and only a selected block can be dragged (`touch-action: none` applies only to the selected block and the handles), so the grid stays scrollable.
- **Remove:** the remove button on hover or selection, or Delete/Backspace when the block has focus.
- **Keyboard:** blocks are focusable. Up/Down moves 15 minutes, Shift+Up/Down resizes by 15 minutes, Left/Right changes the day, and Escape deselects. Empty slots must be reachable too, so the keyboard can open "Add block".
- Ignore clicks for about 350ms after a drag ends, so the click that ends a drag doesn't add a block or deselect.
- Scroll the grid automatically when dragging near its top or bottom edge.
- The progress indicators and the summary update live during a drag. Persist only when the drag ends, and only if something changed.

**Activities**
- Add with validation messages: "Give the activity a name.", "Enter the hours it needs, for example 1.5.", "A day has 24 hours. Enter 24 or less.", "A week has 168 hours. Enter 168 or less.", "Enter how many days per week, from 1 to 7." Hours are rounded to 15 minutes.
- Edit inline in the list item (same form, plus Save, Cancel and Delete). Escape cancels.
- Deleting an activity also deletes its blocks. Show a snackbar with Undo: "Deleted Gym and its 3 blocks."
- A new activity gets the first unused palette color by default.

**History**
- Undo covers every change: block add, move, resize and remove, activity add, edit and delete, Clear week, and Start empty. It keeps up to 100 steps. Ctrl/Cmd+Z works when focus isn't in a form field. The snackbar Undo and the Undo icon button use the same stack.

## Persistence

In the prototype, the plan lived in the claude.ai artifact database. That API exists only inside claude.ai artifacts and is **not** carried over. The real app stores everything in a **SQLite database inside the browser**, set up the same way as [flashcut](https://github.com/SantaClaas/flashcut), with **Drizzle** added on top. There is no backend.

### Database engine (same as flashcut)

- `@tursodatabase/database-wasm`, persisted in OPFS. Import it from `@tursodatabase/database-wasm/vite`.
- It needs `SharedArrayBuffer`, so cross-origin isolation headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`) are required in dev, preview **and** production. Set them in `vite.config.ts` for `server` and `preview`, and in `public/_headers` for the host.
- **Multiple tabs (already built in flashcut, reuse it):** OPFS allows one open database per origin. Flashcut's `src/db/client.ts` elects a leader with `navigator.locks.request(...)`. The tab holding the lock opens the database, runs migrations, and serves a `DbService` (`exec`/`run`/`get`/`all`/`exportFile`/`importFile`/`wipe`). `src/lib/broadcast-service.ts` exposes that service to the other tabs as a typed RPC proxy over BroadcastChannel. It handles request ids, provider discovery, retrying calls that were never sent when a tab gets promoted, and `CallLostError` for calls in flight when the leader changes. Copy both files with only renames (channel and lock names). Don't build a second mechanism.
- **Cross-tab updates:** after a write, broadcast a change event so other open tabs reload the plan (flashcut's `src/lib/broadcast.ts` pattern). A tab never receives its own broadcast.

### Drizzle (new compared to flashcut)

- Use `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4`, pinned exactly. The 1.0 line ships `drizzle-orm/tursodatabase/wasm` and a filesystem-free `drizzle-orm/tursodatabase/wasm-migrator`, and 0.45 doesn't have them. Check the installed package's types before relying on these details.
- **Schema** in `src/db/schema.ts`. Migrations are **generated** with `drizzle-kit generate` into `drizzle/` and committed. Never hand-edit an applied migration.
- **Drizzle sits on top of flashcut's RPC; it doesn't replace it.** Follower tabs have no local database object, so the app's Drizzle instance uses `drizzle-orm/sqlite-proxy`. That driver has no database of its own. It builds the SQL, calls one async callback with `(sql, params, method)`, and maps the returned rows to typed results. The callback just calls the existing `dbService`, which runs the SQL locally on the leader and over BroadcastChannel everywhere else. So every tab uses the same typed queries.
  - **Row shape:** the proxy expects rows as arrays of values in column order (one row for `method === "get"`, a list otherwise). Flashcut's `DbService` returns rows as objects, so add a method that returns arrays, for example using Turso's raw statement mode if its API has one (check it), and verify against Drizzle's sqlite-proxy docs and types.
  - **Atomic writes:** `db.transaction()` over the proxy would send BEGIN, the statements and COMMIT as separate RPC calls, so another tab's query could land in between. Instead, pass Drizzle's batch callback (`drizzle(callback, batchCallback, config)`) and add a `DbService.batch(statements)` that the leader runs inside one transaction (flashcut's `withTransaction`). Use `db.batch([...])` for every multi-statement user action.
- **Migrations run only on the leader**, on its real connection, before it starts serving, using either the `wasm-migrator` (passing the generated SQL as a `Record<string, string>`, for example through `import.meta.glob("../../drizzle/**/*.sql", { query: "?raw", eager: true })`) or the sqlite-proxy migrator. Drizzle tracks applied migrations in its own table. Don't mix that with flashcut's `PRAGMA user_version` scheme.
- **Tests** run in Node against `@tursodatabase/database` (the same async API) through `drizzle-orm/tursodatabase/database`, applying the same generated migrations. No browser is needed for repository tests.

### Suggested tables

Map the data model above roughly like this. Adjust it if Drizzle suggests better, but keep minutes as integers.

- `activities`: `id` text PK, `name`, `hue` int, `mode` text (`week`/`day`), `mins` int, `days` int, `position` int (list order), `created_at` text
- `blocks`: `id` text PK, `activity_id` text → activities (delete its blocks together with the activity, in one transaction), `day` int 0–6, `start` int, `dur` int
- `settings`: a single row with `day_start`, `day_end`, `example` (boolean) and `theme` (`system`/`light`/`dark`)

### Writes and undo

- Write when an action is complete: block added, drag or resize finished, keyboard nudge, activity saved. Never write per pointermove. Make one transaction per user action.
- Undo stays in memory, as in the prototype. Applying an undo step writes the restored state back in one transaction.
- The status in the top app bar reflects the database: "Saved in this browser", "Saving…", or "Not saved". On a write error, show a snackbar that explains what failed, with Retry ("Couldn't save your last change. It's still on screen."), and keep the in-memory state.

### Export, import and reset (required)

Backup works like flashcut's (`src/lib/db-file.ts`, `src/lib/download.ts`, and `exportFile`/`importFile`/`wipe` in `src/db/client.ts`):

- **Export database:** downloads the raw SQLite file as `week-budget-planner-YYYY-MM-DD.db` (`application/vnd.sqlite3`). The leader runs `PRAGMA wal_checkpoint(TRUNCATE)`, briefly closes the database, reads the file bytes from OPFS, then reopens. Calls that arrive in the meantime queue behind the reopen. Export works from any tab.
- **Import database:** the user picks a `.db` file and confirms in a native `<dialog>` ("Replace your plan?") that names the file and how many activities and blocks it replaces, with a link to export first. The leader closes the database, deletes the stale `-wal`, writes the file and makes every tab reload. Run migrations on the imported file at open, so older exports still load.
- **Delete all data:** confirm, delete the database files and reload every tab.
- These live on the Settings page (see Layout), which says that the data lives only in this browser and that export is the backup.

### Also keep

- Sanitize values read from the database, especially after an import.
- "Load an example week" from `examples/example-week.json` (bundle it), marked `example = true`. Offer it in the empty state.

## Design

The app follows **[Material 3 Expressive](https://m3.material.io/blog/building-with-m3-expressive)**, Google's 2025 update of Material Design 3. Build it with plain CSS from the tokens in `docs/design/m3-tokens.css`, without a component library.

**Google is the only source for Material Design:** m3.material.io, the [Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit) in Figma, and Google's own code. Third-party implementations and write-ups are not sources. Only the user can approve a deviation from Google's guidance, and approved deviations are listed under "Deviations" below. The [design canvas](https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk) shows every screen and state.

- **Token sources:** shape, type, motion and component sizes come from Google's own Material 3 tokens ([androidx `material3/tokens`](https://github.com/androidx/androidx/tree/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens)). Colors come from [material-color-utilities](https://github.com/material-foundation/material-color-utilities). Regenerate them from there rather than inventing values.
- **Color:** a `SchemeTonalSpot` light and dark scheme from the seed `#3a5bd9` (a cobalt close to the prototype's accent). Pages sit on `surface-container`, and panes, lists and the grid use a card color (`surface-container-lowest` in light, `surface-container-high` in dark). Over budget uses `error`, and "All placed" uses a green.
- **Theme:** follow `prefers-color-scheme` by default. The Settings choice (Light or Dark) overrides it.
- **Activity colors:** the 8 palette hues, keyed by the stored `hue` value: Blue 255, Red 28, Green 152, Amber 78, Violet 305, Teal 198, Pink 350, Lime 118. Each gets a tonal palette (`TonalPalette.fromHueAndChroma(hue, 48)`):
  - block background: tone 90 light, 30 dark
  - block text: tone 10 light, 90 dark
  - solid (swatch, progress, drag chip): tone 40 light, 80 dark
- **Type:** Google Sans Flex (variable, from Google Fonts) on the M3 type scale, with the emphasized styles for headings and figures. The app name uses the `ROND` axis at 100. Use tabular numerals for times and figures. There is no monospace font.
- **Icons:** Material Symbols Rounded.
- **Shape:** the M3 corner scale (4, 8, 12, 16, 20, 28, 32, 48 and full). Buttons are fully round. Panes, the grid and dialogs use 28. Grouped lists have 20px outer and 4px inner corners with 2px gaps. Blocks use 8 (12 when selected, 4 when 15 minutes long). The selected color swatch morphs from a circle to a rounded square.
- **Components:** small top app bar, navigation bar (64px, pill indicator), connected button groups, filled, tonal, outlined and text buttons, extended FAB, menu, modal bottom sheet, dialog, snackbar, outlined text fields, linear progress indicator with a gap and a stop dot, and a floating toolbar (vibrant, 64px, fully round) for placing.
- **Blocks** are solid tonal fills with no border or side rail. The selected block gets a 2px `primary` ring with a gap, plus elevation.
- **Motion:** M3 Expressive uses springs. Approximate the spatial and effects springs with CSS `linear()` easing curves. Respect `prefers-reduced-motion` by dropping spatial motion and keeping only fades and the progress widths.
- **Touch targets** are at least 48px (40px visual buttons with padding around them).

### Deviations

None approved yet. Every deviation from Google's guidance needs the user's approval before it is built.

### To check against Google

The design canvas made these choices without a Google source. Confirm each against m3.material.io or the Figma kit, and if Google says otherwise, follow Google or ask the user to approve a deviation:

- The grouped list (20px outer corners, 4px inner corners, 2px gaps). These values came from looking at Android's settings, not from a Google spec.
- The activity color palettes at chroma 48. M3's guidance for extra, custom colors may prescribe something else, such as harmonizing them with the scheme.
- Block shapes (8px, 12px when selected, 4px at 15 minutes), the selected ring, and the color swatch that morphs from circle to rounded square.
- Google Sans Flex as the typeface. Google's baseline type tokens use the system sans-serif (Roboto on Android).
- Approximating the springs with CSS `linear()` easing.

Screenshots of the old prototype are in `docs/`. They show the earlier look, not the target design.

## Ideas for later (not in the prototype)

- Several weeks or semesters, or real calendar dates
- Exporting to iCal or Google Calendar
- Fixed blocks such as lectures that are locked in place
- Sync across devices (for example Turso sync, since the database is already Turso)
- Installing as a PWA, like flashcut (its Workbox config raises the precache size limit for the large WASM file)
