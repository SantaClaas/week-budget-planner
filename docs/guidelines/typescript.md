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

- **Only the module that defines a brand creates one**, through its sanitizer, parser or constructor (such as `randomIds.createActivityId()`). Everywhere else, a value gets its brand by going through one of those. Inside the module, one private `brand()` helper holds the only type assertion, with a comment saying why (see Type assertions below).
- **A sanitizer never fails:** `sanitizeLength(value: number): Length` turns any number into the nearest valid value. Use it for data that was loaded and for results of arithmetic, which gives back a plain `number`.
- **A strict parser rejects instead:** `parseBudgetMinutes(minutes, mode)` returns a `Result`: the value or what's wrong with it (`"unreadable"`, `"too-small"`, `"too-large"`). Use it for what users type, so the form can tell them (see Results below).
- **Name the brand for what the value means**, not for its unit alone: `DayMinute` and `WeekMinute` are both minutes, and keeping them apart is the point. Say in the type's comment where it starts and ends and what it's a multiple of.
- **A fixed set of values is a literal union**, not a brand: `Hue` and `Shape` come from the palette and the shape library.
- At the edges, the database checks the same rules again with `CHECK` constraints.

## Results

**What can fail returns a `Result`.** [`src/result.ts`](../../src/result.ts) defines `Result<Value, Problem>`: the value, or what went wrong, as a string literal (`"too-small"`, `"out-of-range"`) or an object that says so (`{ isOk: false, problems }`). The strict parsers, the activity form, reading a plan file and the database import return one. It's a plain union, so the caller tells the cases apart with a comparison and TypeScript narrows the rest. Prefer it to throwing when the caller can do something about the problem, such as telling the user what to fix; throw when it can't.

**The success of an action without a value is a word for what happened**, such as `"saved"`, `"imported"` or `"wiped"`, not `void`. With `void` in the return type, `noImplicitReturns` stops checking: falling off the end counts as success, so a branch that forgets to return its problem compiles. With a word, every path has to return one, the caller reads two outcomes, and a test asserts `toBe("saved")`.

**A throw is for what nobody planned for, or what the caller can only report.** An outcome the code expects and a caller acts on is a value: a file that isn't a plan, or a newer version of the app that saved the plan, comes back as `"invalid-file"` or `"newer-version"` through every layer, from the migrations through the calls between tabs to the stores. What stays a throw is a programming mistake, a full disk, a call lost when the leader tab went away: the caller can't do more than report it, and the planner's Retry snackbar does.

**A throw stops the code above it, which is what an unexpected error needs.** It unwinds through every caller up to the nearest `catch`, so nothing after the mistake runs on state nobody knows. That's Rust's split: `Result` for what's expected, a panic for a bug, since stopping is safer than going on with invalid data. Systems that must not do harm work the same way and fail into a safe state rather than guess. A JavaScript throw has fewer teeth than a panic, because any `catch` on the way can swallow it, so keep each `catch` to the one operation it was written for (see "One operation per `try`" in [`docs/guidelines/principles.md`](principles.md)) and let everything else reach the top. There the action that ran into it ends, the plan on screen stays as it was saved, and the error shows in the console.

**A stack trace tells where an error came from, at a cost a value doesn't have.** The runtime gathers it when the error is created, which takes time we haven't measured, but which a value never spends. For an expected outcome, the value says as much on its own: its name tells what happened (`"newer-version"`, `"invalid-file"`), the layer that returns it is in its type, and an object can carry the details, as the activity form's `{ isOk: false, problems }` does, with a message for each field that is wrong. Where one error does wrap another, `cause` keeps the layers, as `RemoteCallError` keeps the leader tab's error. So keep the trace for what's unexpected, where finding the line is the point.

**A library that can only signal by throwing gets one private error class**, thrown where the value enters the library and caught right where its call returns. Drizzle's sqlite-proxy callback can only give back rows or throw, so [`src/database/drizzle.ts`](../../src/database/drizzle.ts) throws `NewerVersionThroughDrizzle` for a `"newer-version"` answer, and `runOnDatabase` turns it back into the value around the queries; the class never leaves the module. Look along the error's `cause` chain, since a library may wrap the error on the way (Drizzle does, in `DrizzleQueryError`), and test the round trip through the real library.

**A `Result` must be used**, as in Rust, where `Result` is `#[must_use]`. A call whose `Result` is thrown away is a mistake: the value is lost, and so is the problem, which nobody hears about. `pnpm typecheck` runs [`scripts/check-must-use.ts`](../../scripts/check-must-use.ts) after `tsc`, and it fails on a call that's a statement of its own and gives back a `Result`, awaited or not. Where throwing it away is right, `void` in front of the call says so: `void parseDayCount(value)`.

**`@mustUse` marks a function whose value matters** although it isn't a `Result`, like Rust's `#[must_use]` on a function: a function that gives back the way to stop or undo what it started, such as an unsubscribe function. Put the tag in the JSDoc of the function, or of the method in its type. The same check fails where its value is thrown away.

**Promises are the lint's job.** `typescript/no-floating-promises` fails on a promise that's neither awaited, handled with `.catch` or a rejection handler, nor marked with `void`, and `no-misused-promises` on an `async` function passed where nothing waits for it. `void` on a promise doesn't handle its errors: use it only on a promise that can't fail, or that handles its own failure, and say which in a comment.

Everything else may be thrown away without `void`: `array.push()`, `map.set()` and Solid's setters give back a value nobody needs. TypeScript has no plugins and no rule for this, so the check asks its type checker through the API TypeScript 7 ships as `typescript/unstable/sync`. Only our build depends on it, and its test pins down what it relies on, so a TypeScript update that changes the API fails there first.

## Discriminated unions

**A union of object shapes is told apart by a `type` field** holding a string literal, as in `{ type: "result"; id: string; result: unknown } | { type: "error"; id: string; error: unknown }`. It's the one name for it everywhere, not `kind` or `tag`, so every union reads the same. The messages between tabs use it (`"provider-ready"`, `"result"`, `"reload"`).

**A boolean property can tell two shapes apart instead**, as `isOk` does in the activity form's result: `{ isOk: true; value } | { isOk: false; problems }`. Where the question really is yes or no, a boolean says what it means and reads as one in a condition (`if (!result.isOk)`). It's a boolean like any other, so everything in [Booleans](#booleans) above applies: it's named as a question with `is`, and before choosing it, go through "Stored booleans are probably something else" there. If the union could ever grow a third case, or the boolean really stands for a state or a kind, it's a `type` instead. A two-state result passes: it's stored nowhere, and it can't grow a third state without becoming something other than a result. A field that only says which of several equal shapes a value is, like an overnight block's `"first"` or `"second"` part, isn't a discriminator and keeps a name for what it means.

**Switch over `type`, with a case for every value.** The types a place ignores get cases of their own too, ending in `break` with a comment saying why, instead of a `default`. The lint's `typescript/switch-exhaustiveness-check` then reports every type a `switch` doesn't name, so a new message type can't be forgotten on one side, where a `default` would swallow it without a word. The broadcast service's two listeners in [`src/broadcast/service.ts`](../../src/broadcast/service.ts) work this way.

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

The types come from the `ES2025.Iterator` lib in the app's TypeScript config (the configs for code only Node runs, the build scripts and the tests, take all of `ESNext`, since Node is the one runtime there). Browsers without the helpers (Chrome before 122, Firefox before 131, Safari before 18.4) get core-js's polyfill before the app starts, from [`src/polyfill/index.ts`](../../src/polyfill/index.ts) (see [`docs/spec/browser-support.md`](../spec/browser-support.md)), so code can use them anywhere.

## Formatting and linting

**oxfmt formats, oxlint lints, and CI checks both.** Run `pnpm format` and `pnpm lint` before committing. The formatter keeps its defaults: 100 columns, double quotes, trailing commas. Markdown isn't formatted, so tables and long lines in the docs stay as written.

**Both the linter and the compiler are strict.** The lint runs the correctness, suspicious, perf and pedantic categories as errors, with type-aware rules (floating promises, unsafe `any`, misused promises and the like), the `jsx-a11y` rules for the markup in JSX (alt text, labels, valid roles and ARIA states, keyboard access next to click handlers), and a few rules picked from the style and restriction categories. TypeScript runs with `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature` and `noUncheckedSideEffectImports`, and no unused or unreachable code. Everything is checked: the app, the tests, the Vite and oxlint plugins, the build scripts (TypeScript, run by Node directly) and the service worker (plain JavaScript, checked through JSDoc and [`tsconfig.worker.json`](../../tsconfig.worker.json)).

**Node runs our TypeScript as it is.** Everything Node runs is TypeScript run through Node's own type stripping, with no compile step and no loader of our own: the build scripts (`node scripts/build-iconset.ts`), the Vite and Vitest configs (loaded with `--configLoader native`), the oxlint plugin, and the Playwright tests with their static server (`PW_DISABLE_TS_ESM=1` turns off Playwright's own loader, so Node loads the tests; `pnpm test:browser` and CI set it). The one exception is drizzle-kit, which always loads [`drizzle.config.ts`](../../drizzle.config.ts) and the schema through its own loader (jiti) and has no setting to use Node's; it only runs when generating a migration. Type stripping only removes types, so that code sticks to syntax that can simply be erased (`erasableSyntaxOnly`: no `enum`, `namespace` or parameter properties), marks type-only imports (`verbatimModuleSyntax`) and imports other files with their `.ts` extension (`allowImportingTsExtensions`). TypeScript checks the first two and the lint the third (`import/extensions`), so a file Node couldn't run fails before it runs. The app and its tests follow the same rules, although Vite and Vitest compile them, so every module stays as close as it can to one Node could run as it is. JSX is the one thing type stripping can't remove, so `.tsx` files will always need a compile step. The Node version is in [`.node-version`](../../.node-version), and CI uses the same file.

**An exception says why, and the tools check that it does.**

- To skip a lint rule on one line: `// oxlint-disable-next-line rule-name -- why it doesn't apply here`. The reason after `--` is required, at least 10 characters. The local rule `week-budget-planner/require-reason` (in [`oxlint-plugins/`](../../oxlint-plugins/)) fails the lint without one, and the lint also fails on a disable that no longer disables anything.
- To skip a type error: `// @ts-expect-error -- why`, also with a reason of 10 characters or more (`typescript/ban-ts-comment`). `@ts-ignore` and `@ts-nocheck` aren't allowed, since they stay quiet once the error is gone.
- To turn a rule off for a whole kind of file, do it in [`.oxlintrc.json`](../../.oxlintrc.json) with a comment saying why. A file-level `/* oxlint-disable rule -- why */` is for one file with one clear reason, like the stores whose methods are `async` without `await` on purpose.
- Prefer fixing the code. An exception is for when the rule is wrong about this line, not for when the fix is more work.

**Type assertions aren't allowed.** `as`, `<Type>value` and the non-null `!` are lint errors (`typescript/consistent-type-assertions` with `assertionStyle: "never"`, `typescript/no-non-null-assertion`). `as const` is fine, since it only narrows a literal. Instead:

- Check the value: a type guard (`isSqlValue`, `isRecord`), a sanitizer or parser for branded types, or a check that throws with a clear message.
- For a value that may be missing, handle the missing case (`?? fallback`, an early return, or a helper like the tests' `required()` that throws).
- Where an assertion is truly needed, at the edge of a library whose types are wrong or missing, or in a brand module's `brand()` helper, disable the rule on that line with the reason, and cover what it relies on with a test (see Where rules are enforced). Today there are eight, and each says why: the four brand helpers (ids, time values, activity names and `datetime` values), Drizzle's untyped `construct()` and its row type, the RPC proxy, and the service worker's `self`.
