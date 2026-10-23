# Coding guidelines

How code in this project is named, split, styled and checked. The guidelines live in [`docs/guidelines/`](guidelines/), one file per kind of code, so that each context only needs the parts that apply to it.

| File | Applies to | What's in it |
| --- | --- | --- |
| [`principles.md`](guidelines/principles.md) | all code, always | the consumer's needs first, the rule of least power, names, modules and coupling, refactoring, where rules are enforced, linking files and drawing diagrams in the docs |
| [`html.md`](guidelines/html.md) | `.tsx`, `.html` | HTML for the document and CSS for the look, the CSS-off test, the first rule of ARIA, no elements for styling, radio groups that look like buttons, short names with descriptions, classes for what, `data-` attributes for how and native or ARIA attributes for state, boolean attributes, `display: contents` |
| [`typescript.md`](guidelines/typescript.md) | `.ts`, `.tsx`, `.js` | function and boolean names, branded types, iterator helpers instead of array chains, formatting and linting, no type assertions, explained exceptions |
| [`css.md`](guidelines/css.md) | `.css`, and styles set from TypeScript | cascade layers, selectors, rem instead of px, intrinsic sizing, logical properties, forced colors, nesting |
| [`solid.md`](guidelines/solid.md) | [`src/`](../src/) | Solid 2.0's official sources, the app's shape, no HTML from strings |
| [`database.md`](guidelines/database.md) | [`src/database/`](../src/database/), [`src/storage/`](../src/storage/), [`drizzle/`](../drizzle/) | libraries, schema and migrations, repository functions, the storage layer from flashcut |
| [`tests.md`](guidelines/tests.md) | `*.test.ts`, [`e2e/`](../e2e/) | what earns a test, unit and browser tests, keyboard tests, automatic accessibility checks, screen reader checks (Orca in a cloud container) |

Start with the principles; they hold everywhere. Before working on a kind of code, read its file too. Claude Code loads them by itself: [`.claude/rules/`](../.claude/rules/) links to each file, and each file lists the paths it applies to in its front matter, so it loads the first time a matching file is read or edited. The principles have no paths, so they load at the start of every session.

**These are idealistic documents.** They describe the code we strive for, not code we expect to reach perfectly, and if one guideline turns out wrong, the others still apply (see the start of `principles.md`).
