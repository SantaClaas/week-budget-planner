// The repository's own files, for the scripts that check them (scripts/check-links.ts,
// scripts/check-glossary.ts): what Git tracks, and new files it doesn't ignore. So .gitignore is the
// one list of what isn't ours, such as dependencies, build output and caches, and each script only
// names the folders it skips beyond that.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

/**
 * Every file of the repository that Git tracks or would track, as absolute paths. Symbolic links are
 * left out, since they point at files that are listed already, and so are files deleted but still
 * in the index.
 *
 * @param root - The repository's root folder.
 */
export function listFiles(root: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .split("\0")
    .values()
    .filter((path) => path !== "")
    .map((path) => join(root, path))
    .filter((path) => existsSync(path) && lstatSync(path).isFile())
    .toArray();
}

/**
 * Whether a path is inside one of the folders, at any depth.
 *
 * @param path - A path from the repository's root, with `/` between its parts.
 */
export const isInFolder = (path: string, folders: ReadonlySet<string>): boolean =>
  path
    .split("/")
    .slice(0, -1)
    .some((part) => folders.has(part));
