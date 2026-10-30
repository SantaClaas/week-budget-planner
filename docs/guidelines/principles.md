# Principles

How code in this project is named, split and kept honest, whatever the language. The other files in [`docs/guidelines/`](./) add what's specific to one kind of code (see [`docs/CODING-GUIDELINES.md`](../CODING-GUIDELINES.md) for the list). These are guidelines, not laws: follow them by default, and when one doesn't fit, say why in the change.

**This is an idealistic document.** It describes the code we strive for, not code we expect to reach perfectly. Falling short of it in places is normal; the direction is what counts. And as with the severability clause in a contract, if one guideline turns out wrong, or doesn't hold in some case, that doesn't void the others: set that one aside, say why, and the rest still apply.

The behavior and the design are in the spec ([`docs/SPEC.md`](../SPEC.md) lists its files in [`docs/spec/`](../spec/)). The words for things are in its glossary ([`docs/spec/glossary.md`](../spec/glossary.md)), and the code uses those words too (see "Names" below).

## The consumer's needs come first

**Start every piece of work at the needs of whoever consumes it.** In an application people use, that's the user. For an API it's the program on the other side, and the same holds between any two machines. The interface follows from those needs: the user interface from what the user needs, and an API's contract from what its consumer needs. The types, the data and the structure behind it follow from the interface in turn.

Working the other way round, from the backend or a data model toward the screen, builds abstractions nobody asked for. When they don't fit, the interface is usually what gets bent, because it's the harder part to change. That's how an app ends up fetching more than it shows, or making several calls where one would do, and the people using it pay for that.

**It outranks every other guideline here.** We build applications so that people can solve their problems with them. Backend architecture, code "cleanness" and other metrics that look good in a review don't matter if they get in the way of that. When a guideline in this file and the consumer's needs pull in different directions, the needs win, and the change says why. A good user experience is what it looks like when those needs are met.

The other goals an application can have lead back to its consumers too:

- **Earning money** follows from an app that gives people value, not the other way round.
- **Keeping running costs down** keeps the project, or the organization behind it, alive, so it can go on serving its users.
- **Laws** come from the norms a society agreed on, ideally through a democratic process, and they're meant for the common good, which includes the people who use the app. So do the norms nobody enforces that we follow, knowingly or not.
- **Maintainability, speed, security and keeping the user's data safe** matter because users need them, now and in later versions.

This is the same direction as "Bottom-up" under Refactoring: start with the specific thing in front of you, what the consumer needs, and let the structure come out of it.

## The rule of least power

**Solve a problem with the least powerful language that can solve it** ([The Rule of Least Power](https://www.w3.org/2001/tag/doc/leastPower.html), a W3C TAG finding by Tim Berners-Lee and Noah Mendelsohn). A declarative language says *what*, so anything can read and reuse it: the browser, a screen reader, a search engine, reader mode, a translation tool, a tool nobody has written yet. A program in a Turing-complete language says *how*, and you usually have to run it to know what it does. In the finding's words: "Powerful languages inhibit information reuse." Less powerful languages are also easier to secure.

In a web app that order is HTML, then CSS, then JavaScript:

- **HTML** holds the structure and the meaning, and does natively what it can: `<dialog>`, `popover`, `<details>`, form validation, links that navigate. See [`docs/guidelines/html.md`](html.md).
- **CSS** draws: looks, layout, states and motion (`:has()`, `:user-invalid`, transitions, container queries), instead of a script that toggles classes or measures elements.
- **JavaScript** does what only it can: the planner's logic, storage, dragging. Where it touches the page, it sets state (an attribute, a value) and leaves the drawing to CSS.

## Names

**Name things for what they are.** A name should tell a reader what the thing is or does without opening it.

- **No abbreviations.** Write `button`, not `btn`; `database`, not `db`; `parameters`, not `params`; `length`, not `dur`; `--corner-extra-small`, not `--corner-xs`. Very common abbreviations that read as words are fine, such as UUID, URL, ID or API. Units in UI copy ("1 h 30 min") are copy, not names.
- **Use the glossary** for the planner's own words: "block" (never "tile"), "slot", "length", "placing" (never "armed"), "left to place", "over budget". If a new term is needed, add it to the glossary first.
- **Technical code has its own domain.** The database, the tab leader election or the service worker bring their own words (leader, migration, connection, isolation), and code there uses them. The code doesn't have to follow the users' language everywhere. Balancing user requirements and technical requirements is part of the job, and it's why code isn't just generated from a description.
- **Use the platform's or the design system's own name** when it has one. In CSS that's Material's names: `.top-app-bar`, `.active-indicator`, `.drag-handle`, `.title-medium`, `--elevation-level-1`.
- **Code can name a thing differently from the copy.** The glossary's words are the planner's, and the code uses them. But where the copy uses a word that's easier for people and a technical concept already has a name, the code uses the technical name: the Settings page says "Theme", and the code says "color scheme", after the CSS `color-scheme` property whose values it stores. Code has to be clear from a technical point of view first. Copy also changes more often than code, so code names shouldn't follow every rewording.
- **Prefix every key in `localStorage` and `sessionStorage`** with `week-budget-planner.`, as in `week-budget-planner.color-scheme`. Storage is shared by everything on the same origin, and in development that's every app that ever ran on the same `localhost` port, so an unprefixed key like `theme` is bound to collide.
- **The rules stop at the edges.** They apply inside the code we control. At the edges of the application, names belong to the other side: browser and library APIs (`localStorage`, Drizzle's `params` in a batch statement), file formats, network messages and data on disk. We can't rename those, so use them as they are, and say so in a comment where it isn't obvious. Abbreviations are fine there when they help the edge, for example to save space on the wire or on disk. Away from the edges, use names people understand, not the names someone chose for an outside API.

Functions and booleans have naming rules of their own in [`docs/guidelines/typescript.md`](typescript.md).

## Functions

### A pure core, with side effects at the edges

**Write the planner's logic as pure functions.** A pure function gets everything it needs as its arguments and gives everything it does back as its return value. The same input always gives the same output, and nothing outside the function changes: no clock, no randomness, no storage, no DOM, no network, no changes to its arguments. `summarize`, `findFirstFreeSlot`, `layoutLanes`, `readActivityForm` and the sanitizers and parsers work this way. What can fail returns a `Result` instead of throwing (see Results in [`docs/guidelines/typescript.md`](typescript.md)).

**Side effects live at the edges, and only where they can't be avoided:** the database and storage, broadcasting between tabs, the DOM, the clock, new ids. The code at an edge gathers the input, calls the pure core, and applies what comes back, and it stays thin so there's little in it to go wrong. This is the same edge as the funnels in "Vertical first" above. Gary Bernhardt calls the shape "functional core, imperative shell" ([Boundaries](https://www.destroyallsoftware.com/talks/boundaries)).

Why it's worth it:

- **A pure function is tested with input and expected output**, with no setup, no mocks and no browser. That's why the plan's rules can be checked at test time (see "Where rules are enforced" below), and why most of the tests are fast unit tests.
- **It can be understood on its own.** Everything that affects it is in its signature, so a reader, a reviewer or TypeScript sees it all. A bug in it can't depend on what ran before or in another tab.
- **It can run anywhere**: in a tab, in a worker, in a test, or twice, for an undo or a preview, without harm.

**When the core needs something impure, pass it in.** A function that needs the current time takes it as an argument, and one that makes new ids takes an `IdGenerator`. The edge supplies `Temporal.Now.instant()` and `randomIds`. A test passes a fixed time and ids it can predict, so it can check the exact result.

**One action, one `now`.** Read the clock once, where an action starts (a user's click, an import, a message from another tab), and pass that instant down to everything the action records. Then everything written for one action carries the same time and reads as one moment: the example week's `exampleLoadedAt` and the `createdAt` of the rows saved with it, or every row one save writes. Read deeper down, each record gets a time a few milliseconds apart, which is noise at best and breaks comparisons at worst. Pass it only where something records or compares a time; a function that doesn't need one doesn't take one. Measuring how long something takes is different: a timeout or a heartbeat reads `performance.now()` at the edge where it waits.

**Purity is seen from the outside.** Inside, a function may build a `Map`, `push` into a new array or loop with a counter: nobody else can see it, so it's still pure to its callers. What it must not do is change what it was given or anything that outlives the call.

### Return early instead of `else`

**Handle the special cases first and return**, or `continue` in a loop, so the main path runs down the left edge without nesting. An `else` usually means a function does two things in two branches. Then give the branch a function of its own that returns early, and call it. `sanitizePlan` used to loop over `[]` when the stored value wasn't a list; now `sanitizeActivities` and `sanitizeBlocks` each start with `if (!Array.isArray(input)) return []`.

**Put the shorter branch in the `if`.** When a function ends in two branches, the short one goes inside the `if` and returns, and the long one follows unindented. Turn the condition around if that's what it takes: the broadcast service's silence check asks whether the provider is still within the limit, queries and returns, and only then handles the silence.

The lint rule `week-budget-planner/shorter-branch-first` fails on an `if` whose block ends the scope (with `return`, `throw`, `continue` or `break`) and holds more lines of code than the statements after it. It counts lines, not statements, since one statement can span many and the cost is the indented code a reader has to scan; oxfmt decides every line break, so the same code always counts the same. Comments and the statement that ends the block don't count, so a guard whose only statement is a long `throw` passes.

**Choosing between two values is a ternary**, not an `if` with an `else`: `const mode = raw["mode"] === "day" ? "day" : "week"`.

The lint rule `week-budget-planner/no-else` (in [`oxlint-plugins/`](../../oxlint-plugins/)) fails on every `else`. Where one really is the clearest way to write it, disable the rule on that line and say why.

### One operation per `try`

**A `try` wraps the one operation that can fail, and its `catch` handles that failure.** A `catch` can't tell the error it was written for from any other: around more code, it also catches a programming mistake, such as a typo or a wrong assumption, and handles it like the expected failure of the API being called. The mistake then never shows up where it happened, and sometimes never at all, like a parse error that quietly becomes an empty plan. Kept to one operation, everything else throws where it went wrong, which is what we want to see.

- **What isn't an exception isn't thrown.** A missing method or an invalid value is checked and returned early, or comes back as a `Result`, instead of being thrown only to reach the `catch`.
- **Code that continues after the `try` reads its value from a `let` outside it.** The `catch` returns, rethrows or assigns a fallback to the same variable, so after the `try` it always has a value, and the rest of the function runs without nesting. TypeScript checks that: declared without `undefined` in its type, a `let` that a path leaves unassigned is a compile error where it's read.

  ```ts
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return createEmptyPlan();
  }
  return sanitizePlan(data, ids);
  ```

- **Two operations that fail differently get a `try` each**, usually in functions of their own, as in the broadcast service's `answer()`: one `try` for the call, one for posting its result.
- A `try` works like an `if`: a branch, and nesting when it grows. So the same rules apply as for `else` above.

The lint rule `week-budget-planner/one-operation-per-try` fails on a `try` block with more than one statement, or with one that branches or loops. Two statements can still be one operation, such as a transaction's statements and its commit, which succeed or roll back together, or writing a file and closing it, which commits the write: there, disable the rule on that line and say why.

### Clean up with `using`

**A `try`/`finally` that releases a resource is a `using` declaration**, or `await using` when the cleanup is async. The resource is released when the scope ends, however it ends, in the reverse order of declaration, without a `try` around the code that uses it. TypeScript and the build lower the syntax for older browsers, and [`src/polyfill/disposal.ts`](../../src/polyfill/disposal.ts) adds the symbols and stacks where they're missing (see [`docs/spec/browser-support.md`](../spec/browser-support.md)).

- **Most APIs don't support it yet**, since it's new (2025). `DisposableStack` and `AsyncDisposableStack` bridge them: `adopt()` takes a resource and its cleanup function, and `defer()` takes a cleanup on its own. `checkImport` in [`src/database/client.ts`](../../src/database/client.ts) defers deleting the import copy, and `readCopy` adopts the database connection.
- **When the same kind of resource is used in many places**, a small wrapper can make it disposable once, for example a `Proxy` that adds `[Symbol.dispose]` to a library's object and passes everything else through. Write one when a resource keeps coming back, not before (see "Compress when it starts to repeat" below).
- A cleanup that only runs on failure, like rolling back or reopening the database after a failed import, stays a `catch` that cleans up and rethrows.

The lint rule `week-budget-planner/prefer-using` fails on every `finally`. Where one really is the clearest way to write it, disable the rule on that line and say why.

## Modules

**Name a module for what it is.** There are no catch-all folders such as `lib`, `utils`, `shared`, `common` or `helpers`. All code is shared and all of it is useful, so those names say nothing.

**A module belongs to one noun.** Names like `types`, `defaults`, `constants` or `helpers` group code by what kind of code it is, across every noun, which is a horizontal layer in small (see "Vertical first" below). A default only ever applies to one noun, and so does a type: each lives with the noun it's about. The `Activity` type is in [`src/plan/activity/index.ts`](../../src/plan/activity/index.ts), an activity's default color and shape in [`src/plan/activity/look.ts`](../../src/plan/activity/look.ts), and a new block's default length in [`src/plan/block/length.ts`](../../src/plan/block/length.ts).

**Name a module in the singular**: `slot`, `lane`, `migration`, `polyfill`. A module is one concept, and its functions drop its noun, so a namespace import reads as that concept: `slot.findFirstFree()` is the slot module's function, where `slots.findFirstFree()` reads like a list of slots. Plural names stay only where they belong to a convention at the edge: the repository's folders that people and tools expect (`docs/`, `scripts/`, `examples/`, `e2e/`), the plugin folders named after their tools (`vite-plugins/`, `oxlint-plugins/`), and folders that hold assets rather than code, such as `src/icons/`.

**Split by meaning when a file grows.** A file becomes a folder of the same name, with an `index.ts` and submodules beside it: `broadcast.ts` becomes `broadcast/index.ts` and `broadcast/service.ts`. If `broadcast/logger.ts` grows too, it becomes `broadcast/logger/index.ts` with its own submodules. `broadcast.ts` and `broadcast/index.ts` mean the same module.

**Group by a repeated noun, and don't repeat it.** Files like `local-storage-store.ts`, `memory-store.ts` and `database-store.ts` share a noun, so they belong together under it, and the files drop it. Here the `storage` module already says what they are, so they became `storage/local.ts`, `storage/memory.ts` and `storage/database.ts`, with no extra `store/` folder. Each exports `create()`.

**No index files that only re-export.** Import submodules directly, like `../plan/week` or `../broadcast/service`. That works like importing a public submodule in Rust. An `index.ts` holds the module's own code, not a list of names from its submodules.

### Vertical first

**Split by feature before splitting by layer.** Splitting by noun tends to cut the code vertically, by feature, rather than horizontally, by layer (all the components, all the queries, all the helpers).

A feature isn't only something users see, like the week, activities or the budget. Technical requirements are features too: the database, the storage levels, broadcasting between tabs. Each is a pillar of its own.

Picture the features as pillars. Horizontal functionality runs through them like fibers threaded through the pillars, and the fibers can be adjusted to fit each one. A pillar can split into sub-features, which are its submodules in the file tree. Together they grow like a tree, or seen the other way up, like roots, with the horizontal fibers threaded between them. The branches get finer the deeper they go: a feature at the top, narrower sub-features below it, and small, specific pieces at the ends. The other way round, the layers are bars, and every feature has to be threaded through them. Code that many features' paths run through is hard to change and hard to delete, so it fails the package test.

What stays solid, in the centre, are the features. The horizontal parts adjust to them, not the other way round: don't force a feature into the shape of an existing layer *auf Gedeih und Verderb* (come what may).

This doesn't mean avoiding shared code. Sometimes a horizontal connection can't be avoided, or it's simply where the code leads, like the plan types that the week, the activities and storage all use. Then it's a deliberate piece in its own module, shaped by the features that use it.

**Unavoidable layers tend to sit at the edges.** Where the application meets the outside (the database file, the stored format, the network), many paths have to come together, so the layer there works as a funnel. A funnel can turn into a bad bottleneck when it ties too much together, like one repository that every feature's save has to go through. Keep what passes through an edge small, and let each feature own as much of its side of it as it can.

For example, in Rust's axum every endpoint goes through a router, so the router is where the features meet. Instead of exporting every handler and listing them all in one top-level router, each module builds its own `Router` with its handlers and sub-routers and exports only that. `main` then puts together a few routers (`merge`, `nest`) instead of every small branch. The handlers stay private, a feature can be removed with its folder and one line, and the routers nest the same way the modules do. In this project, `storage/index.ts` works the same way: it exports one `open()`, and the app never sees which store it got.

### Coupling

**Export as little as possible.** TypeScript can't enforce visibility the way Rust modules do, so it's a habit, not a rule the compiler checks. A name that's only used inside its file stays unexported. Types that only describe another export's signature usually don't need exporting either.

**The package test.** A module is split well when it, with all its submodules, could be shipped as its own package, or deleted, without touching much else. For example, `broadcast/` depends on nothing else in the app.

**Dependencies go one way.** Two modules never import from each other. When they'd need to, the shared piece usually belongs in a module of its own. [`docs/MODULES.md`](../MODULES.md) draws which module imports which, generated from the imports by `pnpm modules`, and a test fails when the graph has a cycle or the drawing is out of date. In this project the color scheme got its own module (`color-scheme`) when `database` and `storage` both needed its type, since `storage` already imports `database`.

### Code taken from elsewhere

Code adapted from another project, such as flashcut's tab leader and broadcast service, starts out as it was and then follows these guidelines like any other code. Say where it came from in a comment at the top.

## Refactoring

**Bottom-up.** Start with the details: write the specific code each case needs and get it working. Structure comes out of that code, not from a plan drawn up before it. The first details are the consumer's (see "The consumer's needs come first"): the code a screen or a contract needs to serve them.

**Compress when it starts to repeat.** Around the second or third time the same thing shows up is when it starts making sense to think about pulling it out. That's a point to think, not a rule. Other reasons to do it can make it earlier or later: a file that has grown too big to read gets split by meaning before anything repeats, and code that only looks alike but means different things stays apart.

**Compress by meaning, not by text.** The aim is less duplicated meaning: code that does the same thing goes through the same path, and code that is unique stays plain and next to where it's used. Shorter text often follows, but it isn't the goal.

**Let the names come from the code.** Modules, types and grouped functions are what you get after compressing real code. When a noun keeps coming back with different verbs, that noun becomes a module, and its functions drop the noun. This is how the names end up matching the language of the problem.

This is close to what Casey Muratori calls [semantic compression](https://caseymuratori.com/blog_0015), or compression-oriented programming. He avoids the word "refactoring", which he calls "a ridiculous term". His rule is "make your code usable before you try to make it reusable": type out exactly what each case needs, get it working, and pull out the shared part once it repeats. In his example, the variables and calls a UI panel kept repeating became a `Panel_Layout` struct with `row()`, `push_button()` and `complete()`. Its methods don't repeat "layout", just as this project's module functions don't repeat their module's noun.

## Where rules are enforced

The planner's own rules (a block is 15 minutes to a day long and starts on a slot, a block belongs to an activity that exists, a per-day budget counts 1 to 7 days, an import never replaces the plan with something unreadable) have to hold everywhere, in every tab, after every import and in every stored file. **Enforce each rule at the earliest stage that can enforce it.** The earlier the stage, the cheaper a mistake: the editor marks it while it's typed, instead of a user finding a broken plan later. In order:

1. **Design time.** Shape the types so that breaking the rule can't be written at all. A block's length is a `Length`, not a `number`, so only `sanitizeLength` or the strict parsers can make one. A hue is one of the palette's literal values. The example week's state is a time (`exampleLoadedAt`) instead of a boolean that could disagree with it. What can't be represented needs no check anywhere else.
2. **Compile time:** TypeScript and the lint, on every edit and in CI. A plain number where a `Length` goes, a `WeekMinute` passed as a `DayMinute`, or a block whose `activityId` is a `BlockId` doesn't compile, and neither does a call whose `Result` is thrown away (the must-use check that `pnpm typecheck` runs, see Results in [`docs/guidelines/typescript.md`](typescript.md)).
3. **Build time:** what the build derives from the rules, so the copies can't drift apart by hand. drizzle-kit writes the database's `CHECK` constraints from the schema, and the schema takes its limits (`SLOT`, `MAX_LENGTH`, the palette, the shapes) from the same constants as the code.
4. **Test time:** what the compiler can't prove: the sanitizers and parsers that turn raw input into checked values, the week arithmetic across midnight and the week's wrap, the first free slot, and what an import accepts and refuses.
5. **Review time:** whether a rule is the right rule. No tool can say whether a block should be allowed to last more than a day, or whether "1,5" should mean one and a half hours.
6. **Runtime**, last, as a safety net, not the plan: the app's checks at its edges (`sanitizePlan` on everything loaded, the strict parsers on what the user types, the import checks), and the checks the platform makes for us (the database's `CHECK` constraints, the browser's Content Security Policy and Trusted Types).
7. **Monitoring**, after release: what only real use shows. How often loaded plans need repairing, how often imports are refused, which errors users run into and which Content Security Policy violations happen tells us whether a rule is wrong, or whether some version wrote data it shouldn't have. The app doesn't monitor anything yet: it has no backend to report to, and reporting would need the user's consent first (see Browser permissions in [`docs/spec/security.md`](../spec/security.md)). When it's added, it goes here.

**An exception to the type checks moves a rule to a later stage, so it owes a test.** A type assertion (`as`, `!`), a `@ts-expect-error` or a disabled lint rule takes a rule out of compile time. It's like `unsafe`, `unwrap()` or `expect()` in Rust: not bad in itself, but the tool for when the developer knows something is safe and the compiler can't prove it. The proof then becomes the developer's job, in two parts:

- **Say why it's safe**, in the comment the lint requires, the way Rust code puts a `// SAFETY:` comment on an `unsafe` block.
- **Make the reason a test**, so it can't change under our feet. The runtime check that replaces a compile-time proof gets unit tests, including the cases it rejects. The parsers and sanitizers are the example: `parseDecimal`, `parseBudgetMinutes`, `planFile.read` and `sanitizePlan` each have tests for valid input and for input they must refuse or repair, and the brand modules' one `brand()` assertion is only reached through them. The same goes for type guards such as `isSqlValue`, and for code that leans on a library's runtime behavior past its types, such as the RPC proxy or Drizzle's `construct()`.

How tests are chosen is in [`docs/guidelines/tests.md`](tests.md).

## Docs

**Draw diagrams in Mermaid**, in a `mermaid` code block in the Markdown. GitHub and most editors render it, and it stays text: it changes in the same diff as the prose around it, and a review sees what changed. Use a diagram where prose makes the reader build a picture in their head: how data structures relate, the steps between tabs or between the page and a worker, a decision with several outcomes, the states of a mode. Don't draw what a list already says plainly. Render a new diagram once before committing, since a syntax error only shows as an error box on GitHub.

**Link the files the docs mention.** In Markdown, a file or folder named in the text is a relative link, with the path in code: [`docs/spec/glossary.md`](../spec/glossary.md), written `` [`docs/spec/glossary.md`](../spec/glossary.md) ``. The link works on GitHub and in editors, and a broken one shows that a file moved. Write the path from the repository root so it reads the same in every doc, and make the link relative to the doc it's in. Paths that are examples or patterns rather than real files (`broadcast/index.ts`, `*.test.ts`) stay plain code.
