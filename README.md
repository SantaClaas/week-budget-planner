# Week Budget Planner

## **[Open the planner → santaclaas.github.io/week-budget-planner](https://santaclaas.github.io/week-budget-planner/)**

Give each activity (a class, a job, the gym) an hour budget per week or per day. Then put blocks of it on a Monday–Sunday week and resize them until every budget reads "All placed".

The plan stays in your browser, in a SQLite database. Nothing is sent anywhere. To move it to another browser, export it in Settings › Your data and import the file there.

## Develop

Use the Node version in [`.node-version`](.node-version) and pnpm (pinned in [`package.json`](package.json)).

```bash
pnpm install
```

```bash
pnpm dev
```

Before committing, run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm knip` and `pnpm test`. Pushes to `main` are checked and deployed to GitHub Pages by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Where things are

- [`docs/SPEC.md`](docs/SPEC.md): the behavior and design spec, split by topic in [`docs/spec/`](docs/spec/), with the glossary.
- [`docs/CODING-GUIDELINES.md`](docs/CODING-GUIDELINES.md): how the code is named, split, styled and checked.
- [`docs/design/m3-tokens.css`](docs/design/m3-tokens.css): the Material 3 Expressive design tokens.
- [`prototype/week-budget-planner.html`](prototype/week-budget-planner.html): the original single-file prototype, still the reference for behavior.
- [`CLAUDE.md`](CLAUDE.md): context for Claude Code sessions.
