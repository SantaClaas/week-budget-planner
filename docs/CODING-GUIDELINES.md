# Coding guidelines

How code in this project is named, split and styled. These are guidelines, not laws: follow them by default, and when one doesn't fit, say why in the change.

The behavior and the design are in `docs/SPEC.md`. The words for things are in its glossary, and the code uses those words too (see "Names" below).

## Names

**Name things for what they are.** A name should tell a reader what the thing is or does without opening it.

- **No abbreviations.** Write `button`, not `btn`; `database`, not `db`; `parameters`, not `params`; `length`, not `dur`; `--corner-extra-small`, not `--corner-xs`. Very common abbreviations that read as words are fine, such as UUID, URL, ID or API. Units in UI copy ("1 h 30 min") are copy, not names.
- **Use the glossary** for the planner's own words: "block" (never "tile"), "slot", "length", "placing" (never "armed"), "left to place", "over budget". If a new term is needed, add it to the glossary first.
- **Technical code has its own domain.** The database, the tab leader election or the service worker bring their own words (leader, migration, connection, isolation), and code there uses them. The code doesn't have to follow the users' language everywhere. Balancing user requirements and technical requirements is part of the job, and it's why code isn't just generated from a description.
- **Use the platform's or the design system's own name** when it has one. In CSS that's Material's names: `.top-app-bar`, `.active-indicator`, `.drag-handle`, `.title-medium`, `--elevation-level-1`.
- **The rules stop at the edges.** They apply inside the code we control. At the edges of the application, names belong to the other side: browser and library APIs (`localStorage`, Drizzle's `params` in a batch statement), file formats, network messages and data on disk. We can't rename those, so use them as they are, and say so in a comment where it isn't obvious. Abbreviations are fine there when they help the edge, for example to save space on the wire or on disk. Away from the edges, use names people understand, not the names someone chose for an outside API.

### Functions

**A function starts with a verb in the imperative mood**, usually followed by the noun it acts on: `openStorage`, `loadPlan`, `saveTheme`, `moveBlock`.

**Repeated nouns point to a module.** When several functions share a noun (`openStorage`, `readStorage`, `wipeStorage`), that noun may want to be a module of its own, with the functions inside it. The module name already says the noun, so the functions inside drop it: the `storage` module exports `open`, `read` and `wipe`.

**Resolve clashes at the import.** Rust writes `storage::open`. TypeScript has no module paths at call sites, so the import puts the noun back:

- A renamed import goes back to verbNoun: `import { open as openStorage } from "./storage"`. Not `storageOpen`: without Rust's `::` between them, "open" can read as an adjective instead of a verb.
- A namespace import keeps the module name in front, like a Rust path: `import * as jsonFile from "./json-file"`, then `jsonFile.read(file)`. The storage stores use this: `local.create()`, `memory.create()`, `planFile.parse(text)`.

### Booleans

**A predicate is a question.** Functions, variables and fields that hold a boolean start with `is` and, where it reads well, end on an adjective: `isFree`, `isOvernight`, `isStored`, `isDatabaseUsable`, `isRangeOverlapping`. Use `can` or `has` only when `is` would sound really awkward. Type guards read the same way: `isTheme(value)`.

**Stored booleans are probably something else.** In data that is stored or sent (the database, file formats, messages), a boolean often hides a richer type ([That boolean should probably be something else](https://ntietz.com/blog/that-boolean-should-probably-be-something-else/), Nicole Tietz-Sokolskaya):

- **A datetime**, when an action has to happen for the value to change and it only changes once: store when it happened (`confirmedAt`, null until then) instead of `isConfirmed`.
- **An enum**, when the boolean says what kind something is or what state it's in, or when several booleans are mutually exclusive or change together: a `status` or `role` instead of `isFailed`, `isQueued` and `isAdmin`. Enums can grow new cases, and the compiler finds the places that need to handle them.

Inside a function, a boolean for a condition is fine. Naming a long condition with one is often clearer, and it doesn't need anything more.

## Modules

**Name a module for what it is.** There are no catch-all folders such as `lib`, `utils`, `shared`, `common` or `helpers`. All code is shared and all of it is useful, so those names say nothing.

**Split by meaning when a file grows.** A file becomes a folder of the same name, with an `index.ts` and submodules beside it: `broadcast.ts` becomes `broadcast/index.ts` and `broadcast/service.ts`. If `broadcast/logger.ts` grows too, it becomes `broadcast/logger/index.ts` with its own submodules. `broadcast.ts` and `broadcast/index.ts` mean the same module.

**Group by a repeated noun, and don't repeat it.** Files like `local-storage-store.ts`, `memory-store.ts` and `database-store.ts` share a noun, so they belong together under it, and the files drop it. Here the `storage` module already says what they are, so they became `storage/local.ts`, `storage/memory.ts` and `storage/database.ts`, with no extra `store/` folder. Each exports `create()`.

**No index files that only re-export.** Import submodules directly, like `../plan/week` or `../broadcast/service`. That works like importing a public submodule in Rust. An `index.ts` holds the module's own code, not a list of names from its submodules.

### Vertical first

**Split by feature before splitting by layer.** Splitting by noun tends to cut the code vertically, by feature, rather than horizontally, by layer (all the components, all the queries, all the helpers).

A feature isn't only something users see, like the week, activities or the budget. Technical requirements are features too: the database, the storage levels, broadcasting between tabs. Each is a pillar of its own.

Picture the features as pillars. Horizontal functionality runs through them like fibers threaded through the pillars, and the fibers can be adjusted to fit each one. A pillar can split into sub-features, which are its submodules in the file tree. Together they grow like a tree, or seen the other way up, like roots, with the horizontal fibers threaded between them. The other way round, the layers are bars, and every feature has to be threaded through them. Code that many features' paths run through is hard to change and hard to delete, so it fails the package test.

What stays solid, in the centre, are the features. The horizontal parts adjust to them, not the other way round: don't force a feature into the shape of an existing layer *auf Gedeih und Verderb* (come what may).

This doesn't mean avoiding shared code. Sometimes a horizontal connection can't be avoided, or it's simply where the code leads, like the plan types that the week, the activities and storage all use. Then it's a deliberate piece in its own module, shaped by the features that use it.

**Unavoidable layers tend to sit at the edges.** Where the application meets the outside (the database file, the stored format, the network), many paths have to come together, so the layer there works as a funnel. A funnel can turn into a bad bottleneck when it ties too much together, like one repository that every feature's save has to go through. Keep what passes through an edge small, and let each feature own as much of its side of it as it can.

### Coupling

**Export as little as possible.** TypeScript can't enforce visibility the way Rust modules do, so it's a habit, not a rule the compiler checks. A name that's only used inside its file stays unexported. Types that only describe another export's signature usually don't need exporting either.

**The package test.** A module is split well when it, with all its submodules, could be shipped as its own package, or deleted, without touching much else. For example, `broadcast/` depends on nothing else in the app.

**Dependencies go one way.** Two modules never import from each other. When they'd need to, the shared piece usually belongs in a module of its own. In this project `theme` was split out because `database` and `storage` both needed the `Theme` type, and `storage` already imports `database`.

### Code taken from elsewhere

Code adapted from another project, such as flashcut's tab leader and broadcast service, starts out as it was and then follows these guidelines like any other code. Say where it came from in a comment at the top.

## Refactoring

**Bottom-up.** Start with the details: write the specific code each case needs and get it working. Structure comes out of that code, not from a plan drawn up before it.

**Compress when it starts to repeat.** Around the second or third time the same thing shows up is when it starts making sense to think about pulling it out. That's a point to think, not a rule. Other reasons to do it can make it earlier or later: a file that has grown too big to read gets split by meaning before anything repeats, and code that only looks alike but means different things stays apart.

**Compress by meaning, not by text.** The aim is less duplicated meaning: code that does the same thing goes through the same path, and code that is unique stays plain and next to where it's used. Shorter text often follows, but it isn't the goal.

**Let the names come from the code.** Modules, types and grouped functions are what you get after compressing real code. When a noun keeps coming back with different verbs, that noun becomes a module, and its functions drop the noun. This is how the names end up matching the language of the problem.

This is close to what Casey Muratori calls [semantic compression](https://caseymuratori.com/blog_0015), or compression-oriented programming. He avoids the word "refactoring", which he calls "a ridiculous term". His rule is "make your code usable before you try to make it reusable": type out exactly what each case needs, get it working, and pull out the shared part once it repeats. In his example, the variables and calls a UI panel kept repeating became a `Panel_Layout` struct with `row()`, `push_button()` and `complete()`. Its methods don't repeat "layout", just as this project's module functions don't repeat their module's noun.

## CSS

**Cascade layers.** Declare the order once: `@layer reset, base, theme, components, utilities;`. A later layer always wins, so no selector needs extra specificity to beat an earlier one. Use `:where()` inside a layer for defaults that should be easy to override.

- `reset`: removes browser defaults, with element selectors only. No global `*` rule, because it can't be overridden by lower layers or web components.
- `base`: the document's own font, colors and links.
- `theme`: the design tokens as custom properties (`m3-shapes.css` puts its shapes here itself).
- `components`: Material's components and the app's own.
- `utilities`: single-purpose classes that combine with anything: the type roles, `.muted`, `.brand`, the activity colors.

**Avoid px.** Sizes are relative, so the user's text size setting works (WCAG 1.4.4 Resize Text, 1.4.10 Reflow).

- Google's dp and sp become rem by dividing by 16: 16dp = 1rem. (dp is a density-independent pixel, one CSS px at standard density; sp is the same but also follows the text size.)
- Breakpoints use `em`, so larger text switches to the phone layout sooner.
- px is only for hairlines of 1–2px: borders, outlines, grid lines, selection rings.
- Never set a font size on `:root` or `html`. `index.html` opts into the operating system's text size with `<meta name="text-scale" content="scale">`.
- Controls that hold text use a minimum height and grow with the text instead of clipping it.

See the Design section of `docs/SPEC.md` for the details and for Material 3 Expressive itself.
