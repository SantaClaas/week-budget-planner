import { describe, expect, it } from "vitest";

import { readVersion } from "./app-version.ts";

const repository = "https://github.com/SantaClaas/week-budget-planner";
const hash = "74ea9820f6c4d733db094441a707452ec07ecdcc";

describe("app version", () => {
  it("is the commit's date and the commit, linked to the repository at it", () => {
    expect(readVersion(repository, () => `${hash}\n2026-10-17`)).toEqual({
      date: "2026-10-17",
      commit: hash,
      url: `${repository}/tree/${hash}`,
    });
  });

  it("is today's date without git, linked to the main branch", () => {
    expect(readVersion(repository, () => {})).toEqual({
      date: Temporal.Now.plainDateISO("UTC").toString(),
      url: `${repository}/tree/main`,
    });
  });
});
