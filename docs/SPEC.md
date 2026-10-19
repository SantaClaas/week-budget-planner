# Week Budget Planner: product spec

The behavior and the design of the app, split by topic in `docs/spec/`. It describes the working prototype in `prototype/week-budget-planner.html`, plus the decisions made after it. When the spec and the prototype disagree, the spec wins for anything listed in its changes from the prototype; for anything else, ask before diverging from the prototype. The visual design is the [design canvas](https://claude.ai/artifact/7WBfh6DXVehhUMeD6TnoCk) (private, ask the user for access).

| File | What's in it | Loads by itself for |
| --- | --- | --- |
| [`overview.md`](spec/overview.md) | what the app is, the core loop, ideas for later | |
| [`glossary.md`](spec/glossary.md) | the words for things, in the copy and in code | every session |
| [`changes-from-the-prototype.md`](spec/changes-from-the-prototype.md) | where the app differs from the prototype on purpose | |
| [`data-model.md`](spec/data-model.md) | activities, blocks, budgets, sanitizers and strict parsers | |
| [`layout.md`](spec/layout.md) | wide screens and phones, the navigation rail and bar, the app bar, Settings, the version | |
| [`grid-geometry.md`](spec/grid-geometry.md) | the week grid's sizes, hours and lanes | |
| [`interactions.md`](spec/interactions.md) | dragging, placing, resizing, adding a block, the activity forms, undo, the keyboard | |
| [`persistence.md`](spec/persistence.md) | the database, tabs, writes and undo, export and import, keeping the data, hosting, progressive enhancement | `src/database/`, `src/storage/`, `drizzle/`, the service worker |
| [`security.md`](spec/security.md) | the Content Security Policy, Trusted Types, browser permissions | `index.html`, the headers, the Vite config |
| [`design.md`](spec/design.md) | Material 3 Expressive, theme, shapes, text size, approved deviations | `.css` files |
| [`accessibility.md`](spec/accessibility.md) | what screen readers hear and how the keyboard moves: the week, blocks, empty slots, activities, Add block, names and descriptions | `.tsx` and `.html` files |
| [`dates-and-language.md`](spec/dates-and-language.md) | weekdays, times and lengths, formatted with `Intl` in the user's language | |
| [`browser-support.md`](spec/browser-support.md) | what the app needs, the fallbacks and the known gaps | |

Start with the overview and the glossary, then read the files for the feature at hand. Claude Code loads the glossary in every session, and the files in the last column the first time it touches a matching file, through `.claude/rules/`.
