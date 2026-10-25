# Layout

## Wide screens (desktop and tablets, 52.5em and up)

- **Navigation rail** on the left, the full height of the window: what the navigation bar is on a phone, and never shown together with it. Its container fill is off, so it sits on the page background (m3.material.io allows this as long as items keep 3:1 contrast). From the top: a menu button that expands and collapses the rail, centered vertically on the app bar beside it, as m3.material.io's scaffold page shows it (12dp above it in a 64dp app bar, instead of the 44dp of androidx `NavigationRailCollapsedTokens`); then the "New activity" floating action button, with its top level with the top of the page content below the app bar; at least 40dp of space; then **Week**, **Activities** and **Settings** as one group, 4dp apart. Google asks for 3 to 7 destinations, so the rail has the same three as the bar. The FAB rests at elevation level 0, as Google asks for a FAB inside the rail.
  - **Collapsed** (the default; 96dp, androidx `NavigationRailCollapsedTokens`): the menu button shows `menu` and is named "Expand navigation". The FAB is 56dp with only its icon, named "New activity" with a tooltip. Destinations show the icon above the label, with the navigation bar's active indicator (56×32dp, `secondary-container`) and the filled icon when active.
  - **Expanded** (220 to 360dp, androidx `NavigationRailExpandedTokens`, standard: beside the page, which narrows to make room): the menu button shows `menu_open` and is named "Collapse navigation". The FAB becomes the extended "New activity" FAB. Destinations become rows with the label beside the icon (Label Large, 8dp apart), and the active indicator hugs both (56dp tall, 16dp leading space). The menu button carries `aria-expanded`.
  - **Week** is the week with the Activities pane beside it, Google's supporting-pane layout (a fixed 360dp pane beside the focus pane). **Activities** is the activity list as its own page (see below).
- **Top app bar:** the page's name as the headline ("Week", as on phones), the save status ("Saved in this browser", "Saving…", "Saved in limited storage", "Not saved") and an Undo icon button. The save status is a link to Settings › Your data (see Writes and undo in [Persistence](persistence.md)).
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
- **Floating:** the placing toolbar and snackbars (see [Interactions](interactions.md)), at the bottom center.

## Phones (under 52.5em)

- **Navigation bar** (64px) at the bottom with three destinations: **Week**, **Activities**, **Settings**.
- **Week:** a top app bar with the title "Week" and Undo (no overflow menu: Day hours and Clear week are in Settings › Week), then the summary and progress, then the grid filling the rest of the screen. About three days fit across, the next one is just visible at the edge, and the grid scrolls sideways with scroll snapping per day. The placing toolbar floats above the navigation bar.
- **Activities:** the same list as the wide-screen pane, with an extended "New activity" floating action button. Tapping an activity starts placing it and switches to Week.
- **Settings:** the same page as on wide screens. On phones it also holds "Day hours" and "Clear week", which on wide screens sit above the grid.

## Settings page

- **Appearance:**
  - Theme, as a connected button group: System, Light, Dark. Supporting text under it says what System currently resolves to: "System is currently dark." It updates when the system setting changes.
  - Contrast, as a connected button group: System, Less, Standard, More. Supporting text: "System is currently standard." (or "more", "less"). The group stays at standard contrast whichever is chosen (see Contrast in [Design](design.md)).
  - Motion, as a connected button group: System, Reduced, Full. Supporting text: "System is currently full." (or "reduced").
  - Each mirrors a browser setting, so the user can try every level without changing their system, and set this app apart from others. System follows the browser and is the default.
- **Week** (phones only): Day hours, Clear week.
- **Your data:** "Your plan is stored only in this browser. Nothing is uploaded. Export it to keep a backup or to move it to another device." Then Export database, Import database, and Delete all data (in the error color).
- **Storage:** number of activities, number of blocks, database size.
- **About**, the last section: one list item that starts with the GitHub mark (see Deviations in [Design](design.md)): "Version", with "2026-10-17 · 74ea982" (the date and the short commit hash) under it. The whole item is a link that opens the repository at that commit in a new tab, and it ends with the `open_in_new` icon instead of a chevron, so it reads as leaving the app. The icon's label says "Opens in a new tab". A build without git shows only the date, and the item opens the repository's main branch instead (see Version).
- On wide screens it is a full page next to the navigation rail, with Settings active in the rail. The rail's Week leads back.

## Version

Releases are numbered by date, not with semantic versioning. A version number like semver's tells whatever depends on a package whether an update could break it, and nothing depends on this app's version. Where compatibility does matter, for the database and the exported files, the migrations track it, and the app refuses a database or a file from a newer version (see [Persistence](persistence.md)).

- **The version is the date of the commit the app was built from**, as an ISO 8601 date in UTC (`2026-10-17`), plus that commit's hash. The commit's date rather than the build's keeps two builds of the same commit the same version, and the hash tells two releases on the same day apart.
- **The hash is optional.** A build without git, for example from a downloaded archive, has the build's date and no hash, and links to the repository's main branch instead of a commit.
- The build reads both from git ([`vite-plugins/app-version.ts`](../../vite-plugins/app-version.ts)) and gives them to the app as the module `virtual:app-version`. The link goes to `https://github.com/SantaClaas/week-budget-planner/tree/<hash>`, the repository at that commit, or to `…/tree/main` without one.
