# Dates, times and language

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
