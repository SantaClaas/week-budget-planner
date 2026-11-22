import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createIndexPath,
  findStaleExceptions,
  findYoungCrates,
  readExceptions,
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

describe("the exceptions in Cargo.toml", () => {
  const approved = {
    reason: "The fix for an advisory, taken early.",
    "approved-by": "SantaClaas",
    "approved-on": "2026-11-22",
  };

  it("reads each exact version with why, who agreed and when, and until when", () => {
    const exceptions = readExceptions({
      exclude: [
        { name: "url", version: "2.5.9", ...approved, until: "2026-11-27" },
        { name: "form_urlencoded", version: "1.2.3", ...approved },
      ],
    });
    expect(exceptions).toEqual([
      {
        name: "url",
        version: "2.5.9",
        reason: approved.reason,
        approvedBy: "SantaClaas",
        approvedOn: Temporal.PlainDate.from("2026-11-22"),
        until: Temporal.PlainDate.from("2026-11-27"),
      },
      {
        name: "form_urlencoded",
        version: "1.2.3",
        reason: approved.reason,
        approvedBy: "SantaClaas",
        approvedOn: Temporal.PlainDate.from("2026-11-22"),
        until: undefined,
      },
    ]);
  });

  it("has none without the table or without a list", () => {
    expect(readExceptions()).toEqual([]);
    expect(readExceptions({})).toEqual([]);
  });

  it("refuses an exception without a reason, or with one too short to say anything", () => {
    const { reason: _, ...withoutReason } = approved;
    expect(
      readExceptions({ exclude: [{ name: "url", version: "2.5.9", ...withoutReason }] }),
    ).toEqual({ problems: ["url@2.5.9 needs a reason why it's taken early."] });
    expect(
      readExceptions({ exclude: [{ name: "url", version: "2.5.9", ...approved, reason: "fix" }] }),
    ).toEqual({ problems: ["url@2.5.9 needs a reason why it's taken early."] });
  });

  it("refuses an exception without who agreed and when", () => {
    expect(
      readExceptions({ exclude: [{ name: "url", version: "2.5.9", reason: approved.reason }] }),
    ).toEqual({
      problems: [
        "url@2.5.9 needs approved-by: who agreed to take it early.",
        'url@2.5.9 needs approved-on, as "YYYY-MM-DD".',
      ],
    });
  });

  it("refuses dates that aren't YYYY-MM-DD, or aren't days at all", () => {
    for (const until of ["2026-11-31", "27.11.2026", "2026-11-27T00:00", { date: "2026-11-27" }]) {
      expect(
        readExceptions({ exclude: [{ name: "url", version: "2.5.9", ...approved, until }] }),
      ).toEqual({ problems: ['url@2.5.9 has an until that isn\'t a date as "YYYY-MM-DD".'] });
    }
  });

  it("refuses the old form, a plain name@version, and an entry without its version", () => {
    expect(readExceptions({ exclude: ["url@2.5.9"] })).toEqual({
      problems: ["Exception 1 isn't a table."],
    });
    expect(readExceptions({ exclude: [{ name: "url", ...approved }] })).toEqual({
      problems: ["Exception 1 needs the crate's name and its exact version."],
    });
    expect(readExceptions({ exclude: "url@2.5.9" })).toEqual({
      problems: ["release-age.exclude has to be a list of tables."],
    });
  });
});

describe("exceptions that have to go", () => {
  const exception = {
    name: "young",
    version: "1.0.0",
    reason: "The fix for an advisory, taken early.",
    approvedBy: "SantaClaas",
    approvedOn: Temporal.PlainDate.from("2026-11-19"),
    until: undefined,
  };
  const locked = [{ name: "young", version: "1.0.0" }];
  const times = new Map([["young@1.0.0", "2026-11-19T00:00:00Z"]]);

  it("keeps one the lockfile still needs", () => {
    expect(findStaleExceptions([exception], locked, times, NOW, 7)).toEqual([]);
  });

  it("trips the day after its until, in UTC", () => {
    const until = Temporal.PlainDate.from("2026-11-19");
    expect(findStaleExceptions([{ ...exception, until }], locked, times, NOW, 7)).toEqual([
      "young@1.0.0's exception ended on 2026-11-19.",
    ]);
    const today = Temporal.PlainDate.from("2026-11-20");
    expect(findStaleExceptions([{ ...exception, until: today }], locked, times, NOW, 7)).toEqual(
      [],
    );
  });

  it("trips once the version is old enough, or isn't locked any more", () => {
    expect(findStaleExceptions([exception], locked, times, NOW, 1)).toEqual([
      "young@1.0.0 is old enough now (1 days); remove its exception.",
    ]);
    expect(findStaleExceptions([exception], [], times, NOW, 7)).toEqual([
      "young@1.0.0 isn't in Cargo.lock any more; remove its exception.",
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
