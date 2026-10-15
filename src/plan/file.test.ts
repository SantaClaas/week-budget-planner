import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { localDate, parsePlan, serializePlan } from "./file";
import { sanitizePlan } from "./sanitize";

const example = () => sanitizePlan(exampleWeek);

describe("plan file", () => {
  it("round-trips the stored format", () => {
    expect(parsePlan(serializePlan(example()))).toEqual(example());
  });

  it("turns malformed text into an empty plan", () => {
    expect(parsePlan("{not json").activities).toEqual([]);
  });

  it("formats the local date for file names", () => {
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
