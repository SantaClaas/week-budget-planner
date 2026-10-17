// Checks that every action the workflows use is pinned to a commit hash and that the comment on the
// line above names the version that hash is, like this:
//
//   # v7.0.1
//   - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
//
//   node scripts/check-action-pins.ts
//
// zizmor checks the hash pinning too, but not the comment.

import { readdir, readFile } from "node:fs/promises";

const workflows = new URL("../.github/workflows/", import.meta.url);

const USES = /^\s*(?:- )?uses:\s*(\S+)/u;
const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/u;
const VERSION_COMMENT = /^\s*# v\d+(?:\.\d+){0,2}\s*$/u;

const problems: string[] = [];
for (const name of await readdir(workflows)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  const lines = (await readFile(new URL(name, workflows), "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    const reference = USES.exec(line)?.[1];
    if (reference === undefined) continue;
    const where = `.github/workflows/${name}:${index + 1}`;
    if (!PINNED.test(reference)) problems.push(`${where}: ${reference} isn't pinned to a commit hash`);
    if (!VERSION_COMMENT.test(lines[index - 1] ?? "")) {
      problems.push(`${where}: the line above ${reference} must be a comment with its version, like "# v1.2.3"`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
