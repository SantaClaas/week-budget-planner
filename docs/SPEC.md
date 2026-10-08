# Week Budget Planner: product spec

This spec describes the behavior of the working prototype in `prototype/week-budget-planner.html`. The SolidJS app should match it unless a section says the behavior is open for change. When the spec and the prototype disagree, the prototype is what the user has actually tried, so ask before diverging.

## What it is

A planner for one reusable week (Monday to Sunday, no calendar dates). The user creates **activities** (university classes, work, the gym) and gives each one an **hour budget**, either per week or per day. They then drag activities onto a seven-column week grid as **tiles**, then move and resize those tiles. Every activity shows live how much of its budget is still unplaced.

The core loop is: set a budget, place tiles, resize them, and watch "left to place" count down to zero.

## Data model

One plan document per user. The stored shape is the same as `examples/example-week.json`:

```ts
type Plan = {
  v: 1;
  activities: Activity[];
  blocks: Block[];        // the tiles on the grid
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
  dur: number;            // minutes, multiple of 15, min 15
};
```

Time is stored as integer minutes and everything snaps to 15 minutes. Weekly budget: `target(a) = a.mode === "day" ? a.mins * a.days : a.mins`. Placed: the sum of `dur` over that activity's blocks. Left to place: `target − placed`. It can go negative, which means over budget.

Sanitize every loaded plan (from storage or sync): clamp numbers, snap to 15, drop tiles whose activity no longer exists, and de-duplicate ids. The prototype's `sanitize()` is the reference.

## Layout

- **Top bar:** the app name, plus a save status on the right ("Saved to your account", "Saving…", "Saved in this browser only").
- **Left pane, the ledger** (about 20.5rem wide, scrolls on its own):
  - An example-week note, shown only while `example` is true, with "Start empty" and "Keep these".
  - The activity list. Each row has a color swatch, name, budget line ("4 h 30 min per week" or "1 h 30 min per day, 3 days"), the remaining figure on the right ("1 h 30 min / left to place", "All placed / 3 h", or "30 min / over budget"), a progress meter, and an Edit button.
  - A hint line: "Drag an activity onto the week. Or click it, then click a time slot."
  - A "New activity" form with name, hours (step 0.25), counted per week or per day, days (shown only for per day), and a color picker with 8 swatches.
- **Right pane, the week:**
  - A summary line ("20 h placed of 32 h · 12 h left to place") with an overall meter.
  - Tools: a visible hour range (two selects), Undo, and Clear week.
  - The grid. It has a sticky day header row (day name plus the total hours placed that day), a sticky hour gutter on the left, and 7 day columns. Columns are at least 6rem wide and the grid scrolls horizontally on narrow screens. Weekend columns are slightly tinted, and today's weekday is marked in the header.
- **Bottom dock (floating):** a toast with an Undo button, and the "placing" bar described under Interactions.
- **Under 820px wide:** the panes stack, the page scrolls normally, and the grid is capped at 78vh.

## Grid geometry

- 48px per hour, so 12px per 15 minutes. The hour lines are solid and the half-hour lines are fainter.
- The visible range is `[min(dayStart, earliest tile hour), max(dayEnd, latest tile end hour)]`. The grid widens itself so a tile is never hidden. Don't change the range in the middle of a drag.
- Overlapping tiles in a day sit side by side in lanes, like a standard calendar. Group tiles that overlap, then give each one the first lane whose last end is at or before its start.
- Tile content: the name, then the duration and time range ("1h30  10:00–11:30"). The duration can wrap to its own line. Tiles of 30 minutes or less show a single line, "Name · 30m". A 15-minute tile has no top resize handle.

## Interactions

All of these must work with a mouse, touch and the keyboard.

**Creating tiles**
- **Drag from the ledger** (mouse or pen): a press on an activity row followed by more than 4px of movement starts a drag. A chip follows the pointer, and a dashed preview shows where the tile will land. Dropping on a day creates the tile. The start is the 15-minute slot under the pointer, clamped to the visible range.
- **Click to arm:** clicking an activity row "arms" it, and touch always uses this path. A dock bar appears: "Placing **Gym**, 1 h 30 min. Click a time slot." with "Use first free slot" and "Done". While armed, a mouse hovering over the grid shows the preview, and each click on the grid places a tile. Arming switches off on its own once that activity's budget is fully placed. Escape also disarms.
- **First free slot:** scan the days in order, in 15-minute steps within the visible range, for a gap of the default duration. For per-day activities, try days that don't have the activity yet first. If nothing fits, show a toast.
- **Default duration:** for per-day activities it's `mins`; for weekly ones it's 90 minutes (one lecture slot). Cap it at the remaining budget when some is left, and at the visible range. The minimum is 15.

**Editing tiles**
- **Move:** drag the tile body, which can cross days. Keep the grab offset so the tile doesn't jump. Snap to 15 and clamp to the visible range.
- **Resize:** drag the top or bottom handle (7px tall, 4px on short tiles). The minimum is 15 minutes. The top handle keeps the end fixed.
- **Select:** a mouse press selects. On touch, the first tap only selects, and only a selected tile can be dragged (`touch-action: none` applies only to the selected tile and the handles), so the grid stays scrollable.
- **Remove:** the × button on hover or selection, or Delete/Backspace when the tile has focus.
- **Keyboard:** tiles are focusable. Up/Down moves 15 minutes, Shift+Up/Down resizes by 15 minutes, Left/Right changes the day, and Escape deselects.
- Ignore clicks for about 350ms after a drag ends, so the click that ends a drag doesn't place or deselect.
- Scroll the grid automatically when dragging near its top or bottom edge.
- The meters and the summary update live during a drag. Persist only when the drag ends, and only if something changed.

**Activities**
- Add with validation messages: "Give the activity a name.", "Enter the hours it needs, for example 1.5.", "A day has 24 hours. Enter 24 or less.", "A week has 168 hours. Enter 168 or less.", "Enter how many days per week, from 1 to 7." Hours are rounded to 15 minutes.
- Edit inline in the row (same form, plus Save, Cancel and Delete). Escape cancels.
- Deleting an activity also deletes its tiles. Show a toast with Undo: "Deleted Gym and its 3 tiles."
- A new activity gets the first unused palette color by default.

**History**
- Undo covers every change: tile create, move, resize and delete, activity add, edit and delete, Clear week, and Start empty. It keeps up to 100 steps. Ctrl/Cmd+Z works when focus isn't in a form field. The toast Undo uses the same stack.

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
- `blocks`: `id` text PK, `activity_id` text → activities (delete its tiles together with the activity, in one transaction), `day` int 0–6, `start` int, `dur` int
- `settings`: a single row with `day_start`, `day_end`, `example` (boolean)

### Writes and undo

- Write when an action is complete: tile created, drag or resize finished, keyboard nudge, activity saved. Never write per pointermove. Make one transaction per user action.
- Undo stays in memory, as in the prototype. Applying an undo step writes the restored state back in one transaction.
- The status line now reflects the database: "Saved in this browser". On a write error, show a toast that explains what failed and keep the in-memory state.

### Export, import and reset (required)

Backup works like flashcut's (`src/lib/db-file.ts`, `src/lib/download.ts`, and `exportFile`/`importFile`/`wipe` in `src/db/client.ts`):

- **Export database:** downloads the raw SQLite file as `week-budget-planner-YYYY-MM-DD.db` (`application/vnd.sqlite3`). The leader runs `PRAGMA wal_checkpoint(TRUNCATE)`, briefly closes the database, reads the file bytes from OPFS, then reopens. Calls that arrive in the meantime queue behind the reopen. Export works from any tab.
- **Import database:** the user picks a `.db` file and confirms in a native `<dialog>` that their current plan will be replaced. The leader closes the database, deletes the stale `-wal`, writes the file and makes every tab reload. Run migrations on the imported file at open, so older exports still load.
- **Delete all data:** confirm, delete the database files and reload every tab.
- Put these in a small settings popover or page reached from the top bar. Mention that the data lives only in this browser and that export is the backup.

### Also keep

- Sanitize values read from the database, especially after an import.
- "Load example week" from `examples/example-week.json` (bundle it), marked `example = true`. Offer it in the empty state.

## Design

- **Fonts:** Archivo (variable, with width 112–120% for the title, eyebrows and day names) for the UI, and IBM Plex Mono for times and figures. Use tabular numerals.
- **Colors:** defined as oklch tokens with light and dark values (see the `:root` blocks in the prototype). The neutrals are a cool, slightly blue paper. The accent is cobalt (`oklch(0.49 0.19 262)` in light mode, `oklch(0.74 0.13 262)` in dark), with green for done and orange-red for over budget.
- **Tile colors** come from one hue per activity through shared lightness and chroma tokens, so every hue works in both themes:
  - background `oklch(L C h)`: light 0.905 / 0.065, dark 0.34 / 0.07
  - border: light 0.70 / 0.12, dark 0.52 / 0.11
  - text: light 0.30 / 0.09, dark 0.94 / 0.045
  - solid (swatch and meter): light 0.60 / 0.16, dark 0.72 / 0.15
- **Palette hues:** Blue 255, Red 28, Green 152, Amber 78, Violet 305, Teal 198, Pink 350, Lime 118.
- **Tiles** are solid tinted fills with a 4px radius and no colored side rail. The selected tile gets a 2px accent outline.
- Respect `prefers-reduced-motion` (only the meter widths animate).

Screenshots of the prototype are in `docs/`.

## Ideas for later (not in the prototype)

- Several weeks or semesters, or real calendar dates
- Exporting to iCal or Google Calendar
- Fixed tiles such as lectures that are locked in place
- Sync across devices (for example Turso sync, since the database is already Turso)
- Installing as a PWA, like flashcut (its Workbox config raises the precache size limit for the large WASM file)
