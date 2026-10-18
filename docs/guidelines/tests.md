---
paths:
  - "**/*.test.ts"
  - "e2e/**"
---

# Tests

What gets a test and how the tests run. It adds to `docs/guidelines/principles.md`, which always applies; its "Where rules are enforced" says which stage catches what, and why an exception to the type checks owes a test.

**Test where a test adds something.** Coverage numbers are a metric, not the goal. Once a measure becomes a target, it stops being a good measure ([Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law)): aim for coverage and you get tests written to touch lines, not to catch mistakes. A test is worth its code when it pins down a rule, a parser, an edge case or an exception's reason. A smoke test (does it run at all?) only earns its place on a sensitive path that's hard to recover from, where a failure loses or damages the user's data: export and import, migrations, deleting all data, the database opening and the isolation reload. Elsewhere it adds maintenance without telling us anything the types and the other tests don't. Those smoke tests run in a real browser with Playwright (`e2e/`, `pnpm test:browser`), in CI next to the unit tests.

**Unit tests** run with Vitest (`pnpm test`), next to the code they test as `*.test.ts`. The repository functions take the Drizzle database as a parameter, so their tests pass a Node-backed instance (see `docs/guidelines/database.md`).

**Find elements the way users do**: by role and accessible name (`getByRole("button", { name: "Undo" })`), by label or by text, as Playwright recommends. That tests the semantics too. Use a `data-` attribute to check a variant, not to find an element.

**Browser tests** run with Playwright, in `e2e/` (`pnpm test:browser` builds the app and runs them), for the paths where a failure would cost the user their plan. CI installs the matching Chromium. In a cloud container, use the preinstalled one: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:browser`. Add one when a new path could lose the user's data.
