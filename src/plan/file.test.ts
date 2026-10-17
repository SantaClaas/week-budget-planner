import { describe, expect, it } from "vitest";

import * as planFile from "./file";
import { createExampleWeek } from "./example";

const example = () => createExampleWeek(Temporal.Instant.from("2026-10-15T08:00:00Z"));

describe("plan file", () => {
  it("round-trips the stored format", () => {
    expect(planFile.parse(planFile.serialize(example()))).toEqual(example());
  });

  it("turns malformed text into an empty plan", () => {
    expect(planFile.parse("{not json").activities).toEqual([]);
  });

  it("reads only real plan files on import", () => {
    expect(planFile.read(planFile.serialize(example()))).toEqual(example());
    expect(planFile.read("{not json")).toBe("not-a-plan");
    expect(planFile.read('{"name": "something else"}')).toBe("not-a-plan");
    expect(planFile.read("null")).toBe("not-a-plan");
    expect(planFile.read('{"version": 0}')).toBe("not-a-plan");
  });

  it("recognizes a plan file from a newer version", () => {
    expect(planFile.read('{"version": 2, "activities": []}')).toBe("newer-version");
  });
});
