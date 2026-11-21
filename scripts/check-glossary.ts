// Checks that the repository doesn't use the glossary's wrong names: the words in the "Wrong names"
// column of docs/spec/glossary.md, such as "tile" for a block or "armed" for placing.
//
//   node scripts/check-glossary.ts
//
// The glossary is the only list: a word added to its column is checked from then on, so it can't
// drift from what the check knows. Words too common to check by machine, such as "event" (a DOM
// event) or "duration" (Temporal's), are left to review in UNCHECKED below, each with its reason.
//
// A wrong name that is the whole of a quote or a code span, as in `"block" (never "tile")`, is
// mentioned, not used, and passes: the glossary allows a wrong name to point out that it's wrong.
// Identifiers are read as words, so a wrong name inside a camelCase or SNAKE_CASE name is found too.
//
// Its test fails on a use, so the rule is enforced at test time rather than in review (see Where
// rules are enforced in docs/guidelines/principles.md).

import { readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { isInFolder, listFiles } from "./repository.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const GLOSSARY = join(root, "docs/spec/glossary.md");

/**
 * Folders not to check beyond what .gitignore leaves out (see scripts/repository.ts): the vendored
 * skill, the prototype, whose copy predates the glossary and is kept as it was (see
 * docs/spec/changes-from-the-prototype.md), and the downloaded icons.
 */
const SKIPPED_FOLDERS = new Set([".agents", "icons", "prototype"]);

/**
 * Files not to check: the glossary, which lists the wrong names; this check's test, whose examples
 * use them on purpose; and the files that name other people's packages, whose names (such as
 * oxlint's binary for each processor) aren't ours.
 */
const SKIPPED_FILES = new Set([
  GLOSSARY,
  fileURLToPath(new URL("check-glossary.test.ts", import.meta.url)),
  join(root, "pnpm-lock.yaml"),
  join(root, "pnpm-workspace.yaml"),
]);

/** The kinds of files that hold copy, code or docs. */
const CHECKED_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

/**
 * Wrong names the check leaves to review, with the reason. Each is a common word, or a technical
 * term with a meaning of its own in the code, that the check can't tell from a wrong use.
 */
const UNCHECKED = new Map([
  ["plan", "the code's name for the week (`Plan`), and the copy's \"your plan\""],
  ["schedule", "scheduling work, as the browser and Solid do"],
  ["grid", "CSS grid"],
  ["calendar", "Temporal's and Intl's calendars"],
  ["item", "list items, in HTML and Material"],
  ["task", "tasks in the event loop and the tooling"],
  ["event", "DOM events"],
  ["project", "this project"],
  ["category", "a common word"],
  ["icon", "Material Symbols icons"],
  ["badge", "Material's badge component"],
  ["dot", "a common word"],
  ["marker", "a common word"],
  ["goal", "a common word"],
  ["target", "event targets and build targets"],
  ["hours", "a unit"],
  ["entry", "map entries and entry points"],
  ["chunk", "build chunks"],
  ["card", "Material's card component"],
  ["session", "browser and server sessions"],
  ["cell", "a common word"],
  ["gap", "the CSS property"],
  ["duration", "Temporal.Duration and CSS durations"],
  ["size", "a common word"],
  ["height", "the CSS property"],
  ["used", "a common word"],
  ["planned", "a common word"],
  ["remaining", 'a common word, as in "a remaining device"'],
  ["sort", "sorting in code"],
  ["move up", "a common phrase"],
  ["move down", "a common phrase"],
  ["download", "the browser's downloads"],
  ["upload", "a common word"],
  ["backup", "a server's backup in the sync spec, which isn't an export"],
  ["legend", "the HTML element that names a fieldset"],
  ["new block", 'a block being made, in code; the action is "Add block"'],
  ["quota", "the browser's storage quota, and a server's"],
  ["rearrange", "rearranging the week, which moves blocks rather than reordering activities"],
  ["restore", "restoring state, as focus is restored"],
]);

/** A wrong name from the glossary, and the term it stands for. */
export type WrongName = { name: string; term: string };

/** A wrong name in a file. `line` counts from 1. */
export type Use = WrongName & { file: string; line: number };

/** A row of the glossary's table, `| **Term** | Meaning | Wrong names | Notes |`. */
const ROW = /^\|\s*\*\*([^*]+)\*\*\s*\|[^|]*\|([^|]*)\|/u;
/** A wrong name with the term it stands for in brackets: "name (for term)". */
const FOR_TERM = /^(.*?)\s*\(for ([^)]+)\)$/u;

/** One entry of the "Wrong names" column, with the term it stands for. */
function readEntry(entry: string, term: string): WrongName {
  const forTerm = FOR_TERM.exec(entry);
  if (forTerm === null) return { name: entry, term };

  return { name: forTerm[1] ?? entry, term: forTerm[2] ?? term };
}

/**
 * The wrong names in the glossary's table, each with its term. An entry like "backup / restore"
 * gives two names.
 */
export function readWrongNames(glossary: string): WrongName[] {
  return glossary.split("\n").flatMap((line) => {
    const row = ROW.exec(line);
    if (row === null) return [];

    const term = (row[1] ?? "").trim();
    return (row[2] ?? "")
      .split(/,|\s\/\s/u)
      .values()
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .map((entry) => readEntry(entry, term))
      .toArray();
  });
}

/** A wrong name as a pattern: any case, words joined by spaces, hyphens or nothing, plural or not. */
function createPattern(name: string): string {
  return name
    .split(/[\s-]+/u)
    .map((word) => RegExp.escape(word))
    .join("[\\s-]*")
    .concat("(?:e?s)?");
}

/** A wrong name and the patterns that find it used, and mentioned in quotes or code. */
type Search = WrongName & { used: RegExp; mentioned: RegExp };

const createSearch = (wrongName: WrongName): Search => {
  const pattern = createPattern(wrongName.name);
  return {
    ...wrongName,
    used: new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu"),
    mentioned: new RegExp(
      `"${pattern}"|'${pattern}'|\`${pattern}\`|“${pattern}”|‘${pattern}’`,
      "giu",
    ),
  };
};

/** The words of an identifier: `isFree` as `is Free`, `MAX_LENGTH` as `MAX LENGTH`. */
const splitIdentifiers = (line: string): string =>
  line.replaceAll(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2").replaceAll("_", " ");

/** The wrong names a text uses, with their lines. Mentions in quotes or code don't count. */
export function findUses(text: string, wrongNames: WrongName[]): Omit<Use, "file">[] {
  const searches = wrongNames
    .values()
    .filter(({ name }) => !UNCHECKED.has(name.toLowerCase()))
    .map((wrongName) => createSearch(wrongName))
    .toArray();
  return text.split("\n").flatMap((line, index) =>
    searches
      .values()
      .filter((search) => search.used.test(splitIdentifiers(line.replaceAll(search.mentioned, ""))))
      .map(({ name, term }) => ({ name, term, line: index + 1 }))
      .toArray(),
  );
}

/** The wrong names the check leaves to review that the glossary no longer lists. */
export function findStaleExceptions(wrongNames: WrongName[]): string[] {
  const listed = new Set(wrongNames.values().map(({ name }) => name.toLowerCase()));
  return UNCHECKED.keys()
    .filter((name) => !listed.has(name))
    .toArray();
}

/** Every file in the repository that is ours to check. */
const listCheckedFiles = (): string[] =>
  listFiles(root).filter(
    (path) =>
      CHECKED_EXTENSIONS.has(extname(path)) &&
      !SKIPPED_FILES.has(path) &&
      !isInFolder(relative(root, path), SKIPPED_FOLDERS),
  );

/** The wrong names the glossary lists. */
export const readGlossary = (): WrongName[] => readWrongNames(readFileSync(GLOSSARY, "utf8"));

/** The wrong names used in the repository, with paths from its root. */
export function checkRepository(): Use[] {
  const wrongNames = readGlossary();
  return listCheckedFiles()
    .toSorted()
    .flatMap((path) =>
      findUses(readFileSync(path, "utf8"), wrongNames).map(({ name, term, line }) => ({
        file: relative(root, path),
        line,
        name,
        term,
      })),
    );
}

/** A use as one line, in the form editors open: `file:line`. */
export const describe = (use: Use): string =>
  `${use.file}:${use.line.toString()} "${use.name}" is a wrong name: say "${use.term}"`;

if (import.meta.main) {
  const stale = findStaleExceptions(readGlossary());
  for (const name of stale)
    console.error(`"${name}" is left unchecked, but the glossary doesn't list it.`);

  const uses = checkRepository();
  for (const use of uses) console.error(describe(use));

  console.log(
    uses.length === 0 ? "Every name is the glossary's." : `${uses.length.toString()} wrong names.`,
  );
  process.exitCode = uses.length === 0 && stale.length === 0 ? 0 : 1;
}
