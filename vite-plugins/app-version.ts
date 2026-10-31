import { execFileSync } from "node:child_process";

import type { Plugin } from "vite";

type AppVersion = { date: string; commit?: string; url: string };

/** Runs git and returns its output, or undefined when git or the repository isn't there. */
type RunGit = (parameters: readonly string[]) => string | undefined;

function runGit(parameters: readonly string[]): string | undefined {
  try {
    return execFileSync("git", parameters, {
      encoding: "utf8",
      // The date in UTC, so builds in different time zones agree.
      env: { ...process.env, TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function readVersion(repositoryUrl: string, run: RunGit): AppVersion {
  const [hash, date] =
    run(["log", "-1", "--format=%H%n%cd", "--date=format-local:%Y-%m-%d"])?.split("\n") ?? [];
  if (hash === undefined || date === undefined || !/^[0-9a-f]{40}$/u.test(hash)) {
    return { date: Temporal.Now.plainDateISO("UTC").toString(), url: `${repositoryUrl}/tree/main` };
  }
  return { date, commit: hash, url: `${repositoryUrl}/tree/${hash}` };
}

/**
 * Gives the app its version as the module `virtual:app-version`: the date of the commit it was
 * built from, and that commit with a link to the repository at it (see Version in
 * docs/spec/layout.md).
 * The commit's date rather than the build's keeps two builds of the same commit the same version.
 * A build without git, such as one from a downloaded archive, gets today's date and no commit, and
 * links to the repository's main branch instead.
 */
export function appVersion(repositoryUrl: string): Plugin {
  const moduleId = "virtual:app-version";
  const resolvedId = `\0${moduleId}`;
  return {
    name: "week-budget-planner:app-version",
    resolveId: (id) => (id === moduleId ? resolvedId : undefined),
    load: (id) =>
      id === resolvedId
        ? `export default ${JSON.stringify(readVersion(repositoryUrl, runGit))};`
        : undefined,
  };
}
