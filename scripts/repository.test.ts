import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isInFolder, listFiles } from "./repository.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("the repository's files", () => {
  it("are what Git tracks, without what .gitignore leaves out", () => {
    const files = new Set(
      listFiles(root)
        .values()
        .map((path) => relative(root, path)),
    );
    expect(files).toContain("package.json");
    expect(files).toContain("scripts/repository.ts");
    const ignored = ["node_modules/", "dist/", "target/", ".git/"];
    expect(files.values().some((path) => ignored.some((folder) => path.startsWith(folder)))).toBe(
      false,
    );
  });

  it("leave out symbolic links, which point at files listed already", () => {
    const files = new Set(
      listFiles(root)
        .values()
        .map((path) => relative(root, path)),
    );
    expect(files).not.toContain(".claude/rules/principles.md");
    expect(files).toContain("docs/guidelines/principles.md");
  });

  it("are told apart by the folders they're in, at any depth, but not by their own name", () => {
    const folders = new Set(["prototype", "icons"]);
    expect(isInFolder("prototype/week-budget-planner.html", folders)).toBe(true);
    expect(isInFolder("src/icons/iconset.svg", folders)).toBe(true);
    expect(isInFolder("docs/spec/design.md", folders)).toBe(false);
    expect(isInFolder("icons", folders)).toBe(false);
  });
});
