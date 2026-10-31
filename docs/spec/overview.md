# Week Budget Planner: what it is

A planner for one reusable week (Monday to Sunday, no calendar dates). The user creates **activities** (university classes, work, the gym) and gives each one a **budget** of hours, either per week or per day. They then put **blocks** of those activities on a seven-column week, by dragging, by placing, or by tapping an empty slot, and move and resize them. Every activity shows live how much of its budget is still **left to place**.

The core loop is: set a budget, add blocks, resize them, and watch "left to place" count down to zero.

This spec describes the behavior of the working prototype in [`prototype/week-budget-planner.html`](../../prototype/week-budget-planner.html), plus the design decisions made after it (see [Changes from the prototype](changes-from-the-prototype.md)). The SolidJS app should match it. When the spec and the prototype disagree, the spec wins for anything listed in [Changes from the prototype](changes-from-the-prototype.md). For anything else the prototype is what the user has actually tried, so ask before diverging.

The visual design is the [design canvas](https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk) (private, ask the user for access). Its tokens are extracted to [`docs/design/m3-tokens.css`](../design/m3-tokens.css).

## Ideas for later (not in the prototype)

**Long-term direction, not in scope now:** the app may grow into a calendar app, with week planning by budget staying its core and what sets it apart. The likely order: finish the week planner, then export the week as an `.ics` file (one weekly repeating event per block, using block ids as stable event ids), then import other calendars as a read-only background layer, then per-week variants for irregular blocks. Full calendar features (dated events, invites, two-way sync) would come last, if ever. Don't build toward this yet, but avoid choices that block it, such as unstable block ids.

- Several weeks or semesters, per-week variants (exam week, A/B weeks), or real calendar dates
- Exporting to iCal or Google Calendar (`.ics` file)
- Importing other calendars as a read-only background layer
- Fixed blocks such as lectures that are locked in place
- A picture inside an activity's shape instead of a color
- Sync across devices (for example Turso sync, since the database is already Turso). To look into: CRDTs, data types whose changes merge without a central server, as in [Rust and CRDTs](https://kerkour.com/rust-crdt-love) by Sylvain Kerkour. They might also let undo work across tabs, since a step would be a change that merges instead of a whole earlier plan (see Writes and undo in [Persistence](persistence.md)).
- Format settings and translations (see [Dates, times and language](dates-and-language.md))
- Installing as a PWA, like flashcut (its Workbox config raises the precache size limit for the large WASM file)
