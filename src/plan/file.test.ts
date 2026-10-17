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
    expect(planFile.read("{not json")).toBeUndefined();
    expect(planFile.read('{"name": "something else"}')).toBeUndefined();
    expect(planFile.read("null")).toBeUndefined();
  });
});
