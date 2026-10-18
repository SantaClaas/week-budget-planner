---
paths:
  - "src/database/**"
  - "src/storage/**"
  - "drizzle/**"
  - "drizzle.config.ts"
---

# Database

The plan is stored in SQLite in the browser. This adds to `docs/guidelines/principles.md` and `docs/guidelines/typescript.md`; the behavior (the tab leader, the storage levels, export and import) is in `docs/spec/persistence.md`.

- **Libraries:** `@tursodatabase/database-wasm` (SQLite in OPFS, as in flashcut) with `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4`, pinned, since the 1.0 line is also a release candidate.
- **Schema** in `src/database/schema.ts`. Generate migrations with drizzle-kit (`pnpm database:generate`) into `drizzle/` and commit them. Never hand-edit a migration that has been applied; the one hand edit a new one gets is `STRICT` on every table (see `docs/spec/persistence.md`), which a test checks.
- **Repository functions** in `src/database/` take the Drizzle database as a parameter, so tests can pass a Node-backed instance (flashcut's pattern).
- **The storage layer comes from flashcut** ([SantaClaas/flashcut](https://github.com/SantaClaas/flashcut)): its leader election plus export, import and wipe (`src/db/client.ts` there), the typed RPC proxy over BroadcastChannel (`src/lib/broadcast-service.ts`, `src/lib/broadcast.ts`), `src/lib/db-file.ts`, `src/lib/download.ts`, the COOP/COEP headers in `vite.config.ts`, and `public/_headers`. It already solves the hard part of multiple tabs. Change it where that makes sense here, such as this project's names and module layout, and say where it came from (see "Code taken from elsewhere" in the principles).
- **Anything that could lose the user's plan** gets a browser test (see `docs/guidelines/tests.md`).
