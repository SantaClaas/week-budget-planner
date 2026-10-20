---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
---

# TypeScript

How TypeScript (and the little plain JavaScript) in this project is named, typed, formatted and checked. It adds to [`docs/guidelines/principles.md`](principles.md), which always applies.

## Names

### Functions

**A function starts with a verb in the imperative mood**, usually followed by the noun it acts on: `openStorage`, `loadPlan`, `saveColorScheme`, `moveBlock`.

**Repeated nouns point to a module.** When several functions share a noun (`openStorage`, `readStorage`, `wipeStorage`), that noun may want to be a module of its own, with the functions inside it. The module name already says the noun, so the functions inside drop it: the `storage` module exports `open`, `read` and `wipe`.

**Resolve clashes at the import.** Rust writes `storage::open`. TypeScript has no module paths at call sites, so the import puts the noun back:

- A renamed import goes back to verbNoun: `import { open as openStorage } from "./storage"`. Not `storageOpen`: without Rust's `::` between them, "open" can read as an adjective instead of a verb.
- A namespace import keeps the module name in front, like a Rust path: `import * as jsonFile from "./json-file"`, then `jsonFile.read(file)`. The storage stores use this: `local.create()`, `memory.create()`, `planFile.parse(text)`.

### Booleans

**A predicate is a question.** Functions, variables and fields that hold a boolean start with `is` and, where it reads well, end on an adjective: `isFree`, `isOvernight`, `isStored`, `isDatabaseUsable`, `isRangeOverlapping`. Use `can` or `has` only when `is` would sound really awkward. Type guards read the same way: `isTheme(value)`.

**The `is` tells a boolean from a truthy value in a condition.** JavaScript tests any value for truth, so `if (selected)` could check a boolean, or a block that may be `undefined`, or a count that may be `0`, and each one fails differently: `0` and `""` are falsy although they are values. With the prefix, `if (isSelected)` is a yes-or-no question and `if (selectedBlock)` is a check for a value that may be missing, and a reader sees which one it is without looking up the type.

**Names say what a value means, not its type.** `blocks`, not `blockArray`; `name`, not `nameString`; `activitiesById`, not `activityMap`. The type is already in the type, the editor shows it, and it can change (an array becomes a `Set`) while the meaning stays. Booleans are the one exception, for the reason above: in a condition, the name is all there is to tell a boolean from a value that's merely truthy.

**Stored booleans are probably something else.** In data that is stored or sent (the database, file formats, messages), a boolean often hides a richer type ([That boolean should probably be something else](https://ntietz.com/blog/that-boolean-should-probably-be-something-else/), Nicole Tietz-Sokolskaya):

- **A datetime**, when an action has to happen for the value to change and it only changes once: store when it happened (`confirmedAt`, null until then) instead of `isConfirmed`.
- **An enum**, when the boolean says what kind something is or what state it's in, or when several booleans are mutually exclusive or change together: a `status` or `role` instead of `isFailed`, `isQueued` and `isAdmin`. Enums can grow new cases, and the compiler finds the places that need to handle them.

Inside a function, a boolean for a condition is fine. Naming a long condition with one is often clearer, and it doesn't need anything more.

## Branded types

**Give a value its own type when it means something of its own.** A branded type is a plain number or string at runtime, but TypeScript won't let a plain `number`, or a value of another brand, stand in for it. Make one with `Brand` from [`src/brand.ts`](../../src/brand.ts): `type Length = Brand<number, "Length">`. Two reasons call for one, often both at once:

- **The value has rules.** A block's length is a multiple of 15 from 15 to 1440. Once only its sanitizer can make a `Length`, every `Length` is valid, and code that takes one doesn't check again.
- **It could be mixed up with another value of the same plain type.** `updateName(userId: string, name: string)` accepts `updateName(newName, userId)` without complaint. At runtime it finds no such user and fails quietly, or at best returns an error. With `updateName(id: UserId, name: string)` the swap doesn't compile. Ids are the clearest case, since they're often passed next to other strings: an `ActivityId` can't stand in for a `BlockId` either. The same goes for numbers that share a unit but not a meaning, such as `DayMinute` and `WeekMinute`. Whether the other argument (`name` here) needs a brand too is a judgment call: brand it when it's easy to swap with something else, not by reflex.

How to use them:

- **Only the module that defines a brand creates one**, through its sanitizer, parser or constructor (such as `createActivityId()`). Everywhere else, a value gets its brand by going through one of those. Inside the module, one private `brand()` helper holds the only type assertion, with a comment saying why (see Type assertions below).
- **A sanitizer never fails:** `sanitizeLength(value: number): Length` turns any number into the nearest valid value. Use it for data that was loaded and for results of arithmetic, which gives back a plain `number`.
- **A strict parser rejects instead:** `parseBudgetMinutes(minutes, mode)` returns the value or what's wrong with it (`"too-small"`, `"too-large"`, or `undefined`). Use it for what users type, so the form can tell them.
- **Name the brand for what the value means**, not for its unit alone: `DayMinute` and `WeekMinute` are both minutes, and keeping them apart is the point. Say in the type's comment where it starts and ends and what it's a multiple of.
- **A fixed set of values is a literal union**, not a brand: `Hue` and `Shape` come from the palette and the shape library.
- At the edges, the database checks the same rules again with `CHECK` constraints.

## Iterators

**Chain lazily with the iterator helpers, not with array methods.** `array.filter(…).map(…)` builds a whole new array at every step, only to throw it away at the next one. The iterator helpers (`map`, `filter`, `flatMap`, `take`, `drop`, `find`, `some`, `every`, `reduce`, `forEach` and `toArray` on `Iterator.prototype`, and `Iterator.from()`) do the same work lazily: each element goes through the whole chain before the next one starts, nothing is allocated in between, and `find`, `some`, `every` and `take` stop as soon as they have their answer. Older code and most examples use the array methods because the helpers are new (2025), not because they're better.

- **Start from an iterator:** `array.values()`, a `Map`'s or `Set`'s `values()`, `keys()` or `entries()`, `string.matchAll()`, a generator, or `Iterator.from()` for anything else iterable.
- **End with what the consumer needs:** a `for … of` loop, a terminal helper (`find`, `some`, `reduce`), `new Set(…)` or `new Map(…)` (they take an iterator directly), or `toArray()` only where an array is really needed.

```ts
// two arrays allocated and thrown away, just to fill a Set
const taken = new Set(plan.blocks.filter((block) => block.activityId === activity.id).map((block) => block.day));
// one pass, nothing in between
const taken = new Set(plan.blocks.values().filter((block) => block.activityId === activity.id).map((block) => block.day));
```

**Keep the array methods where the result has to be an array anyway.** A single `array.map(f)` allocates the one array it returns, the same as `values().map(f).toArray()`, so it stays as it is. Arrays are also right when the result is used more than once, indexed or measured (an iterator can be walked only once), when it's sorted (`toSorted()`), and where an API or the framework takes an array, such as Solid's `<For each>` or `JSON.stringify`.

The types come from the `ES2025.Iterator` lib in the TypeScript configs. Browsers without the helpers (Chrome before 122, Firefox before 131, Safari before 18.4) get core-js's polyfill before the app starts, from [`src/polyfills.ts`](../../src/polyfills.ts) (see [`docs/spec/browser-support.md`](../spec/browser-support.md)), so code can use them anywhere.

## Formatting and linting

**oxfmt formats, oxlint lints, and CI checks both.** Run `pnpm format` and `pnpm lint` before committing. The formatter keeps its defaults: 100 columns, double quotes, trailing commas. Markdown isn't formatted, so tables and long lines in the docs stay as written.

**Both the linter and the compiler are strict.** The lint runs the correctness, suspicious, perf and pedantic categories as errors, with type-aware rules (floating promises, unsafe `any`, misused promises and the like), the `jsx-a11y` rules for the markup in JSX (alt text, labels, valid roles and ARIA states, keyboard access next to click handlers), and a few rules picked from the style and restriction categories. TypeScript runs with `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature` and `noUncheckedSideEffectImports`, and no unused or unreachable code. Everything is checked: the app, the tests, the Vite and oxlint plugins, the build scripts (TypeScript, run by Node directly) and the service worker (plain JavaScript, checked through JSDoc and [`tsconfig.worker.json`](../../tsconfig.worker.json)).

**An exception says why, and the tools check that it does.**

- To skip a lint rule on one line: `// oxlint-disable-next-line rule-name -- why it doesn't apply here`. The reason after `--` is required, at least 10 characters. The local rule `week-budget-planner/require-reason` (in [`oxlint-plugins/`](../../oxlint-plugins/)) fails the lint without one, and the lint also fails on a disable that no longer disables anything.
- To skip a type error: `// @ts-expect-error -- why`, also with a reason of 10 characters or more (`typescript/ban-ts-comment`). `@ts-ignore` and `@ts-nocheck` aren't allowed, since they stay quiet once the error is gone.
- To turn a rule off for a whole kind of file, do it in [`.oxlintrc.json`](../../.oxlintrc.json) with a comment saying why. A file-level `/* oxlint-disable rule -- why */` is for one file with one clear reason, like the stores whose methods are `async` without `await` on purpose.
- Prefer fixing the code. An exception is for when the rule is wrong about this line, not for when the fix is more work.

**Type assertions aren't allowed.** `as`, `<Type>value` and the non-null `!` are lint errors (`typescript/consistent-type-assertions` with `assertionStyle: "never"`, `typescript/no-non-null-assertion`). `as const` is fine, since it only narrows a literal. Instead:

- Check the value: a type guard (`isSqlValue`, `isRecord`), a sanitizer or parser for branded types, or a check that throws with a clear message.
- For a value that may be missing, handle the missing case (`?? fallback`, an early return, or a helper like the tests' `required()` that throws).
- Where an assertion is truly needed, at the edge of a library whose types are wrong or missing, or in a brand module's `brand()` helper, disable the rule on that line with the reason, and cover what it relies on with a test (see Where rules are enforced). Today there are six, and each says why: the two `brand()` helpers, Drizzle's untyped `construct()` and its row type, the RPC proxy, and the service worker's `self`.
