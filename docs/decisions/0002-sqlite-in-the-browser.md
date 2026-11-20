# 0002 SQLite in the browser, with flashcut's storage layer

**Status:** Accepted, 2026-10-08.

## Context

The prototype kept the plan in the claude.ai artifact database, an API that exists only inside claude.ai artifacts. The app has no backend, so the plan has to live in the browser. Several tabs can be open at once and must share one plan. [Flashcut](https://github.com/SantaClaas/flashcut), by the same author, already stored its data in SQLite in the browser and had solved sharing it between tabs.

## Decision

Store the plan in SQLite in the browser, set up as flashcut does ([Database engine](../spec/persistence.md#database-engine-same-as-flashcut) in [Persistence](../spec/persistence.md)):

- `@tursodatabase/database-wasm`, with the database file in OPFS;
- one tab, elected with a Web Lock, opens the database and serves it; the others call it through flashcut's typed RPC proxy over BroadcastChannel;
- export, import and reset of the whole database as a `.db` file, required from the start ([Export, import and reset](../spec/persistence.md#export-import-and-reset-required)).

Flashcut's code is copied with renames and then follows this project's guidelines, rather than building a second mechanism.

## Alternatives

- **Building the tab sharing anew.** Rejected: flashcut's leader election and RPC already handle request ids, finding the leader, calls that were never sent when a tab is promoted, and calls lost when the leader changes. In the spec's words, it "already solves the hard part of multiple tabs".
- **Other SQLite builds for the browser**, such as SQLite's own WebAssembly build or wa-sqlite. Turso's was chosen because it develops SQLite further, and because Turso's cloud might later offer syncing the database as another way to keep a backup, which hasn't been checked yet (the project's author, 2026-11-20). Flashcut uses it too. Whether the other builds were weighed isn't recorded.
- **IndexedDB, or `localStorage` alone.** Rejected for the main store: a SQLite database file is a more portable format, and SQLite enforces relational rules (column types, keys, `CHECK` constraints), where IndexedDB stores documents (the project's author, 2026-11-20). `localStorage` stays as the limited storage level, for browsers where the database can't run ([Progressive enhancement](../spec/persistence.md#progressive-enhancement)).

## Consequences

- **The page must be cross-origin isolated**, since the engine needs `SharedArrayBuffer`. That decides how the app is hosted (see [0005](0005-github-pages-with-a-service-worker.md)), and every file the page loads is served from its own origin.
- **OPFS allows one open database per origin**, so the leader tab, the RPC between tabs and the time limit on a silent leader are part of the app ([Calls between tabs](../spec/persistence.md#calls-between-tabs)), and so is handling tabs on different versions ([Tabs on different versions](../spec/persistence.md#tabs-on-different-versions)).
- **Where the database can't run**, in a private window or without service workers, the app falls back to lower storage levels, and the planner works the same at each ([Progressive enhancement](../spec/persistence.md#progressive-enhancement)).
- **A large WebAssembly file** is part of what the page loads ([`docs/LOADING.md`](../LOADING.md)).
- Repository code is tested in Node against `@tursodatabase/database`, which has the same API, without a browser.
