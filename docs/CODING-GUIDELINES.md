# Coding guidelines

How code in this project is named, split and styled. These are guidelines, not laws: follow them by default, and when one doesn't fit, say why in the change.

The behavior and the design are in `docs/SPEC.md`. The words for things are in its glossary, and the code uses those words too (see "Names" below).

## Names

**Name things for what they are.** A name should tell a reader what the thing is or does without opening it.

- **No abbreviations.** Write `button`, not `btn`; `database`, not `db`; `parameters`, not `params`; `length`, not `dur`; `--corner-extra-small`, not `--corner-xs`. Very common abbreviations that read as words are fine, such as UUID, URL, ID or API. Units in UI copy ("1 h 30 min") are copy, not names.
- **Use the glossary.** "Block" (never "tile"), "slot", "length", "placing" (never "armed"), "left to place", "over budget". If a new term is needed, add it to the glossary first.
- **Use the platform's or the design system's own name** when it has one. In CSS that's Material's names: `.top-app-bar`, `.active-indicator`, `.drag-handle`, `.title-medium`, `--elevation-level-1`.
- **Keep other people's names at the boundary.** When an outside API fixes a name (Drizzle's `params` in a batch statement, for example), keep it where the API needs it, and say so in a comment.

### Functions

**A function starts with a verb in the imperative mood**, usually followed by the noun it acts on: `openStorage`, `loadPlan`, `saveTheme`, `moveBlock`.

**Repeated nouns point to a module.** When several functions share a noun (`openStorage`, `wipeStorage`, `exportStorage`), that noun may want to be a module of its own, with the functions inside it. The module name already says the noun, so the functions inside drop it: the `storage` module exports `open`, `wipe` and `export`.

**Resolve clashes at the import.** Rust writes `storage::open`. TypeScript has no module paths at call sites, so rename on import when two verbs clash: `import { open as openStorage } from "./storage"`. Whether a prefix form like `storageOpen` reads better is still open.

## Modules

**Name a module for what it is.** There are no catch-all folders such as `lib`, `utils`, `shared`, `common` or `helpers`. All code is shared and all of it is useful, so those names say nothing.

**Split by meaning when a file grows.** A file becomes a folder of the same name, with an `index.ts` and submodules beside it: `broadcast.ts` becomes `broadcast/index.ts` and `broadcast/service.ts`. If `broadcast/logger.ts` grows too, it becomes `broadcast/logger/index.ts` with its own submodules. `broadcast.ts` and `broadcast/index.ts` mean the same module.

**Group by a repeated noun, not by kind.** Files like `local-storage-store.ts`, `memory-store.ts` and `database-store.ts` share a noun, so they could become `store/local-storage.ts`, `store/memory.ts` and `store/database.ts`. As with functions, the folder says "store" so the files don't repeat it.

**No index files that only re-export.** Import submodules directly, like `../plan/week` or `../broadcast/service`. That works like importing a public submodule in Rust. An `index.ts` holds the module's own code, not a list of names from its submodules.

### Coupling

**Export as little as possible.** TypeScript can't enforce visibility the way Rust modules do, so it's a habit, not a rule the compiler checks. A name that's only used inside its file stays unexported. Types that only describe another export's signature usually don't need exporting either.

**The package test.** A module is split well when it, with all its submodules, could be shipped as its own package, or deleted, without touching much else. For example, `broadcast/` depends on nothing else in the app.

**Dependencies go one way.** Two modules never import from each other. When they'd need to, the shared piece usually belongs in a module of its own. In this project `theme` was split out because `database` and `storage` both needed the `Theme` type, and `storage` already imports `database`.

### Code taken from elsewhere

Code adapted from another project, such as flashcut's tab leader and broadcast service, starts out as it was and then follows these guidelines like any other code. Say where it came from in a comment at the top.

## Refactoring

**Wait for three.** Write the specific code first. Pull out a shared function, module or abstraction once the same thing shows up about three times, not when it might show up. This is a guideline with exceptions: a file that has grown too big to read gets split by meaning before anything repeats.

**Compress by meaning, not by text.** The aim is less duplicated meaning: code that does the same thing goes through the same path, and code that is unique stays plain and next to where it's used. Shorter text often follows, but it isn't the goal.

**Let structure come out of the code.** Modules, types and grouped functions are what you get after compressing real code, not a plan drawn up before it. When a noun keeps coming back with different verbs, that noun becomes a module, and its functions drop the noun. This is how the names end up matching the language of the problem.

This is close to what Casey Muratori calls [semantic compression](https://caseymuratori.com/blog_0015): "make your code usable before you try to make it reusable". You type out exactly what each case needs, get it working, and pull out the shared part once it repeats. In his example, the variables and calls a UI panel kept repeating became a `Panel_Layout` struct with `row()`, `push_button()` and `complete()`. Its methods don't repeat "layout", just as this project's module functions don't repeat their module's noun. One difference: he pulls code out at the second occurrence, and this project usually waits for the third.

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
