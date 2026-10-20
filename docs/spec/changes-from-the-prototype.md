# Changes from the prototype

These were decided after the prototype and override it:

- **Material 3 Expressive** replaces the prototype's look (see [Design](design.md)). The interaction model stays the same unless listed here.
- **"Tile" is renamed "block"** and **"armed" is renamed "placing"** everywhere, including copy such as "Deleted Gym and its 3 blocks."
- **Add block from an empty slot.** Clicking or tapping an empty slot while not placing opens a chooser to add a block there. This is the main touch path, since dragging is hard on phones (see [Interactions](interactions.md)).
- **Blocks can cross midnight.** Moving a block keeps its length. If the new start leaves less of the day than the block's length, the rest overflows into the next day's column from 00:00. For example, a 4-hour block moved to start at 22:00 runs until 02:00 the next day. The week wraps, so Sunday continues into Monday. The prototype clamped blocks to one day.
- **The week shows all 24 hours** and opens scrolled to the day hours. The prototype showed only the hours shown (07:00–22:00 by default), growing to fit blocks. "Hours shown" is renamed **day hours**.
- **Activities have a shape as well as a color**, picked freely and independently, with distinct defaults (see [Design](design.md)). The shape replaces the prototype's vertical color bar and also shows small on each block.
- **Navigation is the same on every screen size.** Phones use a navigation bar with Week, Activities and Settings instead of stacking the panes, and wide screens a navigation rail with the same three destinations (see [Layout](layout.md)).
- **Settings is a page**, holding the theme choice and the data actions (export, import, delete). The theme choice (System, Light, Dark) is new.
- **Names are spelled out** in the stored format and the database: `version` (was `v`), `budgetMinutes` (was `mins`), `activityId` (was `act`) and `length` (was `dur`). Nothing was stored in the old format outside the prototype, so there is no conversion.
- **The example week is marked with a time, not a boolean:** `exampleLoadedAt` says when it was loaded and is null once it's kept or replaced (the prototype stored `example: true`). See "Stored booleans" in [`docs/guidelines/typescript.md`](../guidelines/typescript.md).
- **Ids are nanoids** from an alphabet without lookalike characters, so they can appear in URLs (see [Data model](data-model.md)). The prototype used `crypto.randomUUID()`.
- **Dates, times and lengths are formatted by the browser** with the `Intl` APIs, in the user's language and conventions, and dates use Temporal instead of `Date` (see [Dates, times and language](dates-and-language.md)). The prototype built strings like "1 h 30 min" and "07:30" by hand.
- **The new-activity form** is behind the "New activity" floating action button once at least one activity exists: in the navigation rail on wide screens, on the Activities screen on phones. In the empty state it is shown open.
- **The week is built for screen readers and the keyboard** (see [Screen readers and the keyboard](accessibility.md)). Blocks are buttons in lists per day, with spelled-out names, instead of focusable `role="group"` boxes; an empty slot can be reached and used from the keyboard; and moves made with the keys are announced. The prototype had no keyboard path to an empty slot.
