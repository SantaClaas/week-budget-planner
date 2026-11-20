import { describe, expect, it } from "vitest";

import {
  checkRepository,
  createAnchor,
  describe as describeLink,
  findDeadLinks,
  listAnchors,
  listLinks,
} from "./check-links.ts";

/** Files that exist in a test: their paths, and the Markdown of those that are Markdown. */
const createFiles = (markdownByPath: Record<string, string | undefined>) => ({
  isPresent: (path: string) => path in markdownByPath,
  listAnchors(path: string) {
    const markdown = markdownByPath[path];
    return markdown === undefined ? undefined : listAnchors(markdown);
  },
});

describe("links in the docs", () => {
  it("makes a heading's anchor as GitHub does", () => {
    expect(createAnchor("The sync protocol")).toBe("the-sync-protocol");
    expect(createAnchor("What isn't adopted")).toBe("what-isnt-adopted");
    expect(createAnchor("Export, import and reset (required)")).toBe(
      "export-import-and-reset-required",
    );
    expect(createAnchor("Return early instead of `else`")).toBe("return-early-instead-of-else");
    expect(createAnchor("Phase 1: changes that merge")).toBe("phase-1-changes-that-merge");
    expect(createAnchor("See [Network](network.md) first")).toBe("see-network-first");
  });

  it("lists a file's anchors, numbering a heading that repeats", () => {
    const anchors = listAnchors('# Title\n\n## Tests\n\n## Tests\n\n<a id="by-hand"></a>\n');
    expect([...anchors]).toEqual(["title", "tests", "tests-1", "by-hand"]);
  });

  it("doesn't read a heading or a link inside code", () => {
    const markdown = [
      "```md",
      "# Not a heading",
      "[not a link](missing.md)",
      "```",
      "Written as `[text](missing.md)`, or `` [`a`](missing.md) `` with more backticks.",
      "[a link](real.md)",
    ].join("\n");
    expect([...listAnchors(markdown)]).toEqual([]);
    expect(listLinks(markdown)).toEqual([{ target: "real.md", line: 6 }]);
  });

  it("reads inline links, images, titles, angle brackets and definitions", () => {
    const markdown = [
      "[a](one.md) and ![image](two.png)",
      '[b](three.md "A title") and [c](<four five.md>)',
      "[name]: six.md",
    ].join("\n");
    expect(listLinks(markdown).map((link) => link.target)).toEqual([
      "one.md",
      "two.png",
      "three.md",
      "four five.md",
      "six.md",
    ]);
  });

  it("finds a link to a file that isn't there, with its line", () => {
    const files = createFiles({ "/docs/a.md": "", "/docs/b.md": "# B" });
    expect(findDeadLinks("/docs/a.md", "[b](b.md)\n[c](c.md)", files)).toEqual([
      { file: "/docs/a.md", line: 2, target: "c.md", problem: "no such file" },
    ]);
  });

  it("finds a link to a section that isn't there, in another file and in the same one", () => {
    const files = createFiles({ "/docs/a.md": "# A\n\n## Here", "/docs/b.md": "# B\n\n## There" });
    const markdown = "[1](b.md#there) [2](b.md#gone) [3](#here) [4](#gone-too)";
    expect(
      findDeadLinks("/docs/a.md", markdown, files).map((link) => [link.target, link.problem]),
    ).toEqual([
      ["b.md#gone", "no such section"],
      ["#gone-too", "no such section"],
    ]);
  });

  it("resolves a path from the linking file's folder, and reads percent-encoding", () => {
    const files = createFiles({
      "/docs/spec/a.md": "",
      "/docs/guidelines/b c.md": "# B",
      "/src": undefined,
    });
    expect(
      findDeadLinks("/docs/spec/a.md", "[b](../guidelines/b%20c.md#b) [src](../../src/)", files),
    ).toEqual([]);
  });

  it("leaves other sites, mail addresses and paths from the site's root alone", () => {
    const files = createFiles({ "/a.md": "" });
    const markdown = "[1](https://example.com/x#y) [2](mailto:a@example.com) [3](/absolute) [4]()";
    expect(findDeadLinks("/a.md", markdown, files)).toEqual([]);
  });

  it("only checks the section of a file that is Markdown", () => {
    const files = createFiles({ "/a.md": "", "/code.ts": undefined });
    expect(findDeadLinks("/a.md", "[line](code.ts#L10)", files)).toEqual([]);
  });

  it("describes a dead link as file:line, the problem and the target", () => {
    expect(
      describeLink({ file: "docs/a.md", line: 3, target: "b.md#gone", problem: "no such section" }),
    ).toBe("docs/a.md:3 no such section: b.md#gone");
  });

  it("finds no dead link in the repository's Markdown files (run pnpm links)", () => {
    expect(checkRepository().map((link) => describeLink(link))).toEqual([]);
  });
});
