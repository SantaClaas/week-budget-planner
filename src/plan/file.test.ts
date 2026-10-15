import { describe, expect, it } from "vitest";

import * as planFile from "./file";
import { createExampleWeek } from "./example";

const example = () => createExampleWeek(new Date("2026-10-15T08:00:00Z"));

describe("plan file", () => {
  it("round-trips the stored format", () => {
    expect(planFile.parse(planFile.serialize(example()))).toEqual(example());
  });

  it("turns malformed text into an empty plan", () => {
    expect(planFile.parse("{not json").activities).toEqual([]);
  });

  it("formats the local date for file names", () => {
    expect(planFile.formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
