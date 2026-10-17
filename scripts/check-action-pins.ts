// Checks that every action the workflows use is pinned to a commit hash, that the comment on the
// line above names a version, and that the hash is the commit that version's tag points to:
//
//   # v7.0.1
//   - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
//
//   node scripts/check-action-pins.ts
//
// Needs network access to github.com, to look up the tags. zizmor checks the hash pinning too, but
// it only reads a version comment at the end of the line (see .github/zizmor.yml).

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

const workflows = new URL("../.github/workflows/", import.meta.url);

const USES = /^\s*(?:- )?uses:\s*(\S+)/u;
const PINNED = /^(?<repository>[\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@(?<hash>[0-9a-f]{40})$/u;
const VERSION_COMMENT = /^\s*# (?<version>v\d+(?:\.\d+){0,2})\s*$/u;

/** The commit a tag points to, following annotated tags to their commit. */
function findTaggedCommit(repository: string, tag: string): string | undefined {
  const output = execFileSync(
    "git",
    [
      "ls-remote",
      "--tags",
      `https://github.com/${repository}`,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ],
    { encoding: "utf8" },
  );
  // The dereferenced line (`^{}`), when there is one, comes last and names the commit.
  const commit = output.trim().split("\n").at(-1)?.split("\t")[0];
  return commit === "" ? undefined : commit;
}

const problems: string[] = [];
for (const name of await readdir(workflows)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  const lines = (await readFile(new URL(name, workflows), "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    const reference = USES.exec(line)?.[1];
    if (reference === undefined) continue;
    const where = `.github/workflows/${name}:${index + 1}`;
    const pin = PINNED.exec(reference)?.groups;
    const version = VERSION_COMMENT.exec(lines[index - 1] ?? "")?.groups?.["version"];
    if (pin === undefined) {
      problems.push(`${where}: ${reference} isn't pinned to a commit hash`);
      continue;
    }
    if (version === undefined) {
      problems.push(
        `${where}: the line above ${reference} must be a comment with its version, like "# v1.2.3"`,
      );
      continue;
    }
    const repository = pin["repository"] ?? "";
    const commit = findTaggedCommit(repository, version);
    if (commit !== pin["hash"]) {
      problems.push(
        `${where}: ${repository} ${version} is ${commit ?? "not a tag"}, not ${pin["hash"] ?? ""}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
