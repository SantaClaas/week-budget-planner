// Checks the links in the repository's Markdown files: that a linked file exists, and that a link
// to a section (`file.md#section`, or `#section` in the same file) names a heading that is there.
//
//   node scripts/check-links.ts
//
// Its test fails when a link is dead, so a file that moved or a heading that was reworded shows
// up where it broke (see Docs in docs/guidelines/principles.md). Links to other sites are not
// followed: that needs the network, and a site being down would fail the tests.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Folders whose Markdown isn't ours to check: dependencies, build output, the vendored skill, and
 * `.claude/`, whose rule files are links to the docs and would be read from the wrong folder.
 */
const SKIPPED_FOLDERS = new Set([
  ".agents",
  ".claude",
  ".git",
  ".stryker-tmp",
  "dist",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
]);

/** A link whose target isn't there. `line` counts from 1. */
export type DeadLink = {
  file: string;
  line: number;
  target: string;
  problem: "no such file" | "no such section";
};

/** A fenced code block's opening or closing line. */
const FENCE = /^\s*(?:`{3,}|~{3,})/u;
/** A code span, between runs of backticks of the same length. */
const CODE_SPAN = /(`+)[^`](?:.*?[^`])?\1(?!`)/gu;
/** An inline link or image, `[text](target)` or `[text](target "title")`, in angle brackets or not. */
const INLINE_LINK = /\]\(\s*(?:<([^>]*)>|([^\s)]*))(?:\s+"[^"]*")?\s*\)/gu;
/** A link definition, `[name]: target`. */
const DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/u;
/** A heading, `# Title`, with its closing `#`s left out. */
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/u;
/** An anchor written as HTML, `<a id="x">` or `<a name="x">`. */
const HTML_ANCHOR = /<a\s[^>]*\b(?:id|name)="([^"]+)"/gu;
/** A link to somewhere other than a file here, such as `https:` or `mailto:`. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

/** The lines of a Markdown text that aren't in a fenced code block; the others are left empty. */
function blankFences(markdown: string): string[] {
  let isInFence = false;
  return markdown.split("\n").map((line) => {
    if (FENCE.test(line)) {
      isInFence = !isInFence;
      return "";
    }

    return isInFence ? "" : line;
  });
}

/** A heading's text as a reader sees it: without code marks, emphasis marks and link targets. */
const readHeadingText = (heading: string): string =>
  heading
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll(/[`*]/gu, "")
    .trim();

/**
 * The anchor GitHub gives a heading: lower case, everything but letters, digits, `_`, `-` and
 * spaces dropped, and each space a hyphen.
 */
export const createAnchor = (heading: string): string =>
  readHeadingText(heading)
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}_\- ]/gu, "")
    .replaceAll(" ", "-");

/**
 * Every anchor a link can point to in a Markdown text: one per heading, and the HTML ones. A
 * heading that repeats gets `-1`, `-2` and so on, as on GitHub.
 */
export function listAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of blankFences(markdown)) {
    for (const match of line.matchAll(HTML_ANCHOR)) anchors.add(match[1] ?? "");

    const heading = HEADING.exec(line)?.[1];
    if (heading === undefined) continue;

    const anchor = createAnchor(heading);
    const count = counts.get(anchor) ?? 0;
    counts.set(anchor, count + 1);
    anchors.add(count === 0 ? anchor : `${anchor}-${count.toString()}`);
  }

  return anchors;
}

/** The targets of the links in a Markdown text, with their lines. Code isn't read. */
export function listLinks(markdown: string): { target: string; line: number }[] {
  return blankFences(markdown).flatMap((text, index) => {
    const line = text.replaceAll(CODE_SPAN, "");
    const definition = DEFINITION.exec(line);
    const targets = [
      ...line.matchAll(INLINE_LINK).map((match) => match[1] ?? match[2] ?? ""),
      ...(definition ? [definition[1] ?? definition[2] ?? ""] : []),
    ];
    return targets.map((target) => ({ target, line: index + 1 }));
  });
}

/** What a checker needs to know about the files: which exist, and a Markdown file's anchors. */
type Files = {
  exists(path: string): boolean;
  /** The anchors of the Markdown file at `path`, or nothing when it isn't one. */
  listAnchors(path: string): Set<string> | undefined;
};

/** A percent-encoded part of a link as text, or as it is when it isn't valid encoding. */
function decode(part: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    return part;
  }

  return decoded;
}

/** What's wrong with one link from the file at `path`, or nothing. */
function findProblem(path: string, target: string, files: Files): DeadLink["problem"] | undefined {
  if (target === "" || HAS_SCHEME.test(target) || target.startsWith("//")) return undefined;

  const [linkedPath = "", anchor] = target.split("#", 2);
  // A path from the site's root can't be checked against the folders here.
  if (linkedPath.startsWith("/")) return undefined;

  const linked = linkedPath === "" ? path : resolve(dirname(path), decode(linkedPath));
  if (!files.exists(linked)) return "no such file";

  if (anchor === undefined || anchor === "") return undefined;

  const anchors = files.listAnchors(linked);
  if (anchors === undefined) return undefined;

  return anchors.has(decode(anchor).toLowerCase()) ? undefined : "no such section";
}

/** The dead links in the Markdown text of the file at `path`. */
export function findDeadLinks(path: string, markdown: string, files: Files): DeadLink[] {
  return listLinks(markdown).flatMap(({ target, line }) => {
    const problem = findProblem(path, target, files);
    return problem === undefined ? [] : [{ file: path, line, target, problem }];
  });
}

/** Every Markdown file in the repository that is ours to check. */
function listMarkdownFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : listMarkdownFiles(path);

    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

/** The dead links in the repository's Markdown files, with paths from its root. */
export function checkRepository(): DeadLink[] {
  const anchorsByPath = new Map<string, Set<string>>();
  const files: Files = {
    exists: existsSync,
    listAnchors(path) {
      const known = anchorsByPath.get(path);
      if (known || !path.endsWith(".md")) return known;

      const anchors = listAnchors(readFileSync(path, "utf8"));
      anchorsByPath.set(path, anchors);
      return anchors;
    },
  };
  return listMarkdownFiles(root)
    .toSorted()
    .flatMap((path) => findDeadLinks(path, readFileSync(path, "utf8"), files))
    .map(({ file, line, target, problem }) => ({
      file: relative(root, file),
      line,
      target,
      problem,
    }));
}

/** A dead link as one line, in the form editors open: `file:line`. */
export const describe = (link: DeadLink): string =>
  `${link.file}:${link.line.toString()} ${link.problem}: ${link.target}`;

if (import.meta.main) {
  const dead = checkRepository();
  for (const link of dead) console.error(describe(link));

  console.log(
    dead.length === 0 ? "Every link leads somewhere." : `${dead.length.toString()} dead links.`,
  );
  process.exitCode = dead.length === 0 ? 0 : 1;
}
