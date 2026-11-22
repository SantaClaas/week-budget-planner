// Checks that every crate version in Cargo.lock was published at least as long ago as
// `registry.global-min-publish-age` in .cargo/config.toml says (see The supply chain in
// docs/guidelines/rust.md). Cargo applies that age when it picks a version, but keeps a version
// that's already in the lockfile, however it got there; pnpm checks its lockfile against its age on
// every install (minimumReleaseAge in pnpm-workspace.yaml). This script is that half for Cargo.
//
//   node scripts/check-crate-age.ts
//
// It asks Cargo for the locked crates (`cargo metadata --locked`) and the crates.io index for when
// each version was published. Exceptions are in [workspace.metadata.release-age] in Cargo.toml, one
// table per exact version with the reason it's taken early: an entry without one fails the check.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** A crate from crates.io as Cargo.lock has it. */
type LockedCrate = { name: string; version: string };

/** A crate version too young to build, or one whose age couldn't be found. */
export type YoungCrate = LockedCrate & { publishedAt: string | undefined };

/** The registry the crates come from, as Cargo writes it in a package's `source`. */
const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index";
const DAY = 24 * 60 * 60 * 1000;

/**
 * The path of a crate's file in the crates.io index, which Cargo's index format sets: one or two
 * letters in folders `1/` and `2/`, three in `3/<first letter>/`, and longer names under their first
 * two pairs of letters.
 */
export function createIndexPath(name: string): string {
  const lower = name.toLowerCase();
  if (lower.length <= 2) return `${lower.length.toString()}/${lower}`;

  if (lower.length === 3) return `3/${lower.slice(0, 1)}/${lower}`;

  return `${lower.slice(0, 2)}/${lower.slice(2, 4)}/${lower}`;
}

/** When each version of a crate was published, from its file in the index (one JSON per line). */
export function readPublishTimes(indexFile: string): Map<string, string> {
  return new Map(
    indexFile
      .split("\n")
      .values()
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        const entry: unknown = JSON.parse(line);
        if (typeof entry !== "object" || entry === null) return [];

        const version = "vers" in entry ? entry.vers : undefined;
        const time = "pubtime" in entry ? entry.pubtime : undefined;
        return typeof version === "string" && typeof time === "string" ? [[version, time]] : [];
      }),
  );
}

/**
 * The locked crates that are younger than the minimum, or whose publish time isn't known, unless
 * an exception names their exact version.
 *
 * @param publishTimes - When each `name@version` was published, as the index says.
 * @param now - The time the check runs.
 * @param exceptions - Exact versions allowed anyway, as `name@version`.
 */
export function findYoungCrates(
  crates: readonly LockedCrate[],
  publishTimes: ReadonlyMap<string, string>,
  now: Temporal.Instant,
  minimumDays: number,
  exceptions: ReadonlySet<string>,
): YoungCrate[] {
  const oldest = now.epochMilliseconds - minimumDays * DAY;
  return crates
    .values()
    .filter((crate) => !exceptions.has(`${crate.name}@${crate.version}`))
    .map(({ name, version }) => ({
      name,
      version,
      publishedAt: publishTimes.get(`${name}@${version}`),
    }))
    .filter(
      (crate) =>
        crate.publishedAt === undefined ||
        Temporal.Instant.from(crate.publishedAt).epochMilliseconds > oldest,
    )
    .toArray();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The minimum age in days from Cargo's config: `global-min-publish-age` as "N days" or "N weeks",
 * the forms Cargo's documentation suggests, or undefined when it isn't set in one of them.
 */
export function readMinimumDays(config: string): number | undefined {
  const match = /^\s*global-min-publish-age\s*=\s*"(\d+) (days?|weeks?)"/mu.exec(config);
  if (match === null) return undefined;

  const count = Number(match[1]);
  return match[2]?.startsWith("week") === true ? count * 7 : count;
}

/** The shortest reason an exception may give, as for a disabled lint rule (require-reason). */
const MINIMUM_REASON_LENGTH = 10;

/**
 * The exceptions from `[workspace.metadata.release-age]`, as `name@version`, or what's wrong with
 * them: every entry is a table with the crate's `name`, its exact `version` and a `reason` of at
 * least ten characters.
 *
 * @param settings - The `release-age` table, as `cargo metadata` gives it, or nothing without one.
 */
export function readExceptions(settings?: unknown): Set<string> | { problems: string[] } {
  if (settings === undefined) return new Set();

  const excluded = isRecord(settings) ? (settings["exclude"] ?? []) : undefined;
  if (!Array.isArray(excluded)) {
    return { problems: ["release-age.exclude has to be a list of tables."] };
  }

  const problems = excluded.flatMap((entry: unknown, index) => {
    const position = `Exception ${(index + 1).toString()}`;
    if (!isRecord(entry)) return [`${position} isn't a table with name, version and reason.`];

    const { name, version, reason } = entry;
    if (typeof name !== "string" || typeof version !== "string") {
      return [`${position} needs the crate's name and its exact version.`];
    }

    return typeof reason === "string" && reason.trim().length >= MINIMUM_REASON_LENGTH
      ? []
      : [`${name}@${version} needs a reason why it's taken early.`];
  });
  if (problems.length > 0) return { problems };

  return new Set(
    excluded
      .values()
      .flatMap((entry: unknown) =>
        isRecord(entry) && typeof entry["name"] === "string" && typeof entry["version"] === "string"
          ? [`${entry["name"]}@${entry["version"]}`]
          : [],
      ),
  );
}

/** The locked crates from crates.io and the exceptions, from `cargo metadata`. */
function readWorkspace(): { crates: LockedCrate[]; exceptions: Set<string> } {
  const output = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--quiet"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const metadata: unknown = JSON.parse(output);
  if (!isRecord(metadata) || !Array.isArray(metadata["packages"])) {
    throw new TypeError("cargo metadata gave no packages.");
  }

  const crates = metadata["packages"]
    .values()
    .flatMap((item: unknown) =>
      isRecord(item) &&
      item["source"] === CRATES_IO &&
      typeof item["name"] === "string" &&
      typeof item["version"] === "string"
        ? [{ name: item["name"], version: item["version"] }]
        : [],
    )
    .toArray();
  const workspace = isRecord(metadata["metadata"]) ? metadata["metadata"] : {};
  const exceptions = readExceptions(workspace["release-age"]);
  if (!(exceptions instanceof Set)) {
    throw new TypeError(`Cargo.toml's crate age exceptions: ${exceptions.problems.join(" ")}`);
  }

  return { crates, exceptions };
}

/** Asks the index when each version of the crates was published. */
async function fetchPublishTimes(crates: readonly LockedCrate[]): Promise<Map<string, string>> {
  const names = [...new Set(crates.values().map((crate) => crate.name))];
  const files = await Promise.all(
    names.map(async (name) => {
      const response = await fetch(`https://index.crates.io/${createIndexPath(name)}`);
      if (!response.ok) {
        throw new Error(`The index has no ${name} (${response.status.toString()}).`);
      }

      return { name, times: readPublishTimes(await response.text()) };
    }),
  );
  return new Map(
    files
      .values()
      .flatMap(({ name, times }) =>
        times.entries().map(([version, time]) => [`${name}@${version}`, time] as const),
      ),
  );
}

if (import.meta.main) {
  const minimumDays = readMinimumDays(
    readFileSync(new URL("../.cargo/config.toml", import.meta.url), "utf8"),
  );
  if (minimumDays === undefined) {
    throw new Error('.cargo/config.toml sets no global-min-publish-age as "N days" or "N weeks".');
  }

  const { crates, exceptions } = readWorkspace();
  const young = findYoungCrates(
    crates,
    await fetchPublishTimes(crates),
    Temporal.Now.instant(),
    minimumDays,
    exceptions,
  );
  for (const crate of young) {
    console.error(
      `${crate.name}@${crate.version} ${crate.publishedAt === undefined ? "has no publish time in the index" : `was published ${crate.publishedAt}`}`,
    );
  }

  console.log(
    young.length === 0
      ? `Every one of ${crates.length.toString()} crates is at least ${minimumDays.toString()} days old.`
      : `${young.length.toString()} crates are younger than ${minimumDays.toString()} days. Wait, or add an exception with a reason to Cargo.toml.`,
  );
  process.exitCode = young.length === 0 ? 0 : 1;
}
