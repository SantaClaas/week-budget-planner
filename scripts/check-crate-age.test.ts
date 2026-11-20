import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createIndexPath,
  findYoungCrates,
  readMinimumDays,
  readPublishTimes,
} from "./check-crate-age.ts";

const NOW = Temporal.Instant.from("2026-11-20T12:00:00Z");

describe("the crates.io index", () => {
  it("finds a crate's file by the length of its name", () => {
    expect(createIndexPath("a")).toBe("1/a");
    expect(createIndexPath("cc")).toBe("2/cc");
    expect(createIndexPath("syn")).toBe("3/s/syn");
    expect(createIndexPath("log")).toBe("3/l/log");
    expect(createIndexPath("tokio")).toBe("to/ki/tokio");
    expect(createIndexPath("Inflector")).toBe("in/fl/inflector");
  });

  it("reads when each version was published", () => {
    const file = [
      '{"name":"axum","vers":"0.8.8","pubtime":"2025-12-20T16:27:24Z"}',
      '{"name":"axum","vers":"0.8.9","pubtime":"2026-04-14T07:55:20Z"}',
      '{"name":"axum","vers":"0.1.0"}',
      "",
    ].join("\n");
    expect(readPublishTimes(file)).toEqual(
      new Map([
        ["0.8.8", "2025-12-20T16:27:24Z"],
        ["0.8.9", "2026-04-14T07:55:20Z"],
      ]),
    );
  });
});

describe("crates younger than a week", () => {
  const times = new Map([
    ["old@1.0.0", "2026-01-01T00:00:00Z"],
    ["exactly@1.0.0", "2026-11-13T12:00:00Z"],
    ["young@1.0.0", "2026-11-19T00:00:00Z"],
  ]);

  it("lets through a version at least a week old", () => {
    const crates = [
      { name: "old", version: "1.0.0" },
      { name: "exactly", version: "1.0.0" },
    ];
    expect(findYoungCrates(crates, times, NOW, 7, new Set())).toEqual([]);
  });

  it("refuses a younger version, and one whose publish time isn't known", () => {
    const crates = [
      { name: "young", version: "1.0.0" },
      { name: "unknown", version: "1.0.0" },
    ];
    expect(findYoungCrates(crates, times, NOW, 7, new Set())).toEqual([
      { name: "young", version: "1.0.0", publishedAt: "2026-11-19T00:00:00Z" },
      { name: "unknown", version: "1.0.0", publishedAt: undefined },
    ]);
  });

  it("lets through an exception only at its exact version", () => {
    const crates = [
      { name: "young", version: "1.0.0" },
      { name: "young", version: "1.0.1" },
    ];
    expect(findYoungCrates(crates, times, NOW, 7, new Set(["young@1.0.0"]))).toEqual([
      { name: "young", version: "1.0.1", publishedAt: undefined },
    ]);
  });
});

describe("the minimum age in Cargo's config", () => {
  it("reads it in days or weeks", () => {
    expect(readMinimumDays('[registry]\nglobal-min-publish-age = "7 days"\n')).toBe(7);
    expect(readMinimumDays('global-min-publish-age = "2 weeks"')).toBe(14);
    expect(readMinimumDays('global-min-publish-age = "1 day"')).toBe(1);
  });

  it("gives nothing for a form it doesn't read, so the check fails instead of passing", () => {
    expect(readMinimumDays("[registry]\n")).toBeUndefined();
    expect(readMinimumDays('global-min-publish-age = "36 hours"')).toBeUndefined();
    expect(readMinimumDays('# global-min-publish-age = "7 days"')).toBeUndefined();
  });

  it("is as long as pnpm waits for npm packages", () => {
    const config = readFileSync(new URL("../.cargo/config.toml", import.meta.url), "utf8");
    const pnpm = readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");
    const minutes = Number(/^minimumReleaseAge: (\d+)$/mu.exec(pnpm)?.[1]);
    expect(readMinimumDays(config)).toBe(minutes / (24 * 60));
  });
});
