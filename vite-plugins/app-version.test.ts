import { describe, expect, it } from "vitest";

import { readVersion } from "./app-version.ts";

const repository = "https://github.com/SantaClaas/week-budget-planner";
const hash = "74ea9820f6c4d733db094441a707452ec07ecdcc";
const now = Temporal.Instant.from("2026-11-11T23:30:15.678Z");

describe("app version", () => {
  it("is the commit's date and the commit, linked to the repository at it", () => {
    expect(readVersion(repository, () => `${hash}\n2026-10-17`, now)).toEqual({
      date: "2026-10-17",
      commit: hash,
      url: `${repository}/tree/${hash}`,
      builtAt: "2026-11-11T23:30:15Z",
    });
  });

  it("is the build's date in UTC without git, linked to the main branch", () => {
    expect(readVersion(repository, () => {}, now)).toEqual({
      date: "2026-11-11",
      url: `${repository}/tree/main`,
      builtAt: "2026-11-11T23:30:15Z",
    });
  });
});
