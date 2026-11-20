---
paths:
  - "drizzle/**"
  - "src/database/schema.ts"
  - "src/plan/file.ts"
  - "src/storage/**"
  - "src/broadcast/protocol/**"
  - "examples/example-week.json"
---

# Stored formats

Every format the app writes that another version of the app may read later: a database in this browser, a file exported months ago, or another tab still running last week's code. For each, it says how it's versioned, what this version accepts, and how it changed, newest first, so a change can tell what it must keep reading, and someone importing an old export can find out whether it still works.

**Add an entry in the same change** that changes a format: a new migration, a new `version` of the plan file, or a new protocol version. A test fails when a migration in [`drizzle/`](../../drizzle/) has no entry below. The app's version is the date and commit it was built from (see Version in [Layout](layout.md)), so the entries are dated by the commit that made the change.

## What this version accepts

| Format | Where it's written | Versioned by | Accepts | Refuses |
| --- | --- | --- | --- | --- |
| [Database](#database) | OPFS at the full storage level; exported and imported as `.db` | Drizzle's list of applied migrations in `__drizzle_migrations` | any database whose migrations are all known, migrating it to the latest at open | a database listing a migration this version doesn't know: "saved by a newer version" |
| [Plan file](#plan-file) | `localStorage` (`week-budget-planner.plan`) at the limited storage level; exported and imported as `.json` | `version` | `version` 1 | `version` above 1: "from a newer version"; anything else: "isn't a Week Budget Planner plan" |
| [Messages between tabs](#messages-between-tabs) | BroadcastChannel, never stored | `protocolVersion` in every message | protocol 1 | any other: ignored, and an older tab steps down |

How a newer version is refused, and what the person sees, is in [Export, import and reset](persistence.md#export-import-and-reset-required) and [Tabs on different versions](persistence.md#tabs-on-different-versions) in [Persistence](persistence.md). The settings in `localStorage` (theme, contrast, the answer to the keep-the-plan card) are single values, read with a fallback, and aren't versioned.

## Database

The schema is [`src/database/schema.ts`](../../src/database/schema.ts), and each change to it is a migration that drizzle-kit generates into [`drizzle/`](../../drizzle/) (see [`docs/guidelines/database.md`](../guidelines/database.md)). A migration is never edited once it has been released, since databases record it by name. An older export imports into a newer app because the migrations run on the imported copy before it replaces anything.

### `20261120020448_stamps`, 2026-11-20

Commit `129eda9`, "Save the plan through the merge's rows, with stamps in the database".

- **What changed:** the plan is stored as rows with registers and stamps, ready to merge with other devices (see [Storage](merge.md#storage) in [Merging changes](merge.md)). Every register of `activities`, `blocks` and `settings` gets a `_stamp` column, a removed activity or block stays as a deletion marker (`is_deleted`, `existence_stamp`), the list order moves from `position` to `order_key`, and a new table `node` holds this database's node id and clock.
- **What happens to an existing database:** every register gets the lowest stamp, every row is kept as it was (none was deleted before), and each activity's place in the old order becomes an order key of two base-62 digits. drizzle-kit's SQL dropped the data when it rebuilt the tables, so the copying was rewritten by hand, and a test runs it on a database with a plan from before (`the migration to stamps` in [`src/database/plan-repository.test.ts`](../../src/database/plan-repository.test.ts)).
- **Older exports:** a `.db` export from before this migration imports, and is migrated on import.

### `20261017210803_init`, 2026-10-17

Commit `7377be3`, "Make every table STRICT".

- **What it holds:** the tables `activities`, `blocks` and `settings`, every rule of the plan as a `CHECK` constraint, and `STRICT` on every table.
- **Before it:** between 2026-10-13 and 2026-10-17, the first migration was generated again five times while the storage layer was being built, under other names (`20261013210347_init` to `20261017145337_init`). A database made by a build of those days lists a name this version doesn't know, so the app reads it as saved by a newer version and won't open it. Only the project's author used the app then, and clearing the site's data in the browser starts over.

## Plan file

The plan as JSON, written by `serialize` and read by `read` in [`src/plan/file.ts`](../../src/plan/file.ts), with keys in a stable order. [`examples/example-week.json`](../../examples/example-week.json) is an example of it. The same text is the plan in `localStorage` at the limited storage level and the `.json` export at every level. A loaded plan goes through `sanitizePlan`, so a field this version doesn't know is dropped and a missing one gets its default (see [Data model](data-model.md)). That's why a field can be added without a new `version`, and only a change an older version would misread needs one.

### Version 1, 2026-10-15

Commits `35cd35b` and `3da263f`, before the first build that read or wrote it.

- **What it holds:** `version`, `exampleLoadedAt` (a time, or null), `dayStart`, `dayEnd`, `activities` (`id`, `name`, `hue`, `shape`, `mode`, `budgetMinutes`, `days`) and `blocks` (`id`, `activityId`, `day`, `start`, `length`). It has no stamps: the limited levels don't merge (see [The limited storage levels](merge.md#the-limited-storage-levels) in [Merging changes](merge.md)).
- **Before it:** the prototype's format, with `v`, `mins`, `act` and `dur`, and `example` as a boolean. The app has never read it: it has no `version`, so an import says it isn't a plan.

## Messages between tabs

Not stored, but read across versions: after an update, an old tab and a new one share the plan. The messages of each released protocol version are frozen in a file of their own under [`src/broadcast/protocol/`](../../src/broadcast/protocol/), and a test compares the current messages with them (see [Tabs on different versions](persistence.md#tabs-on-different-versions) in [Persistence](persistence.md)).

### Protocol 1, 2026-10-30

Commit `5085443`, frozen in [`src/broadcast/protocol/version-1.ts`](../../src/broadcast/protocol/version-1.ts). The first version that carries `protocolVersion`.

## Later

Syncing will add formats that leave the browser: the changes and snapshots sent between devices, encoded with postcard (see [The envelope](sync.md#the-envelope) in [The sync protocol](sync.md)). They get a section here when they're built.
