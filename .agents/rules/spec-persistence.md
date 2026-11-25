---
trigger: glob
globs: "src/database/**, src/storage/**, drizzle/**, drizzle.config.ts, public/service-worker.js, public/_headers"
description: "SQLite storage, multi-tab coordination, undo, export/import, hosting, and progressive enhancement."
---
Read @../../docs/spec/persistence.md before changing database, storage, migration, or hosting/service-worker code (referenced rather than inlined because it exceeds Antigravity's 24 KB per-rule inline limit).
