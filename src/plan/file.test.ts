import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import * as planFile from "./file";
import { sanitizePlan } from "./sanitize";

const example = () => sanitizePlan(exampleWeek);

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
