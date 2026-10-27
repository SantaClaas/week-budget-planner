import { describe, expect, it } from "vitest";

import * as planFile from "./file.ts";
import { createExampleWeek } from "./example.ts";
import { createPredictableIds } from "./test-data.ts";

const example = () =>
  createExampleWeek(Temporal.Instant.from("2026-10-15T08:00:00Z"), createPredictableIds());

describe("plan file", () => {
  it("round-trips the stored format", () => {
    expect(planFile.parse(planFile.serialize(example()), createPredictableIds())).toEqual(
      example(),
    );
  });

  it("turns malformed text into an empty plan", () => {
    expect(planFile.parse("{not json", createPredictableIds()).activities).toEqual([]);
  });

  it("reads only real plan files on import", () => {
    expect(planFile.read(planFile.serialize(example()), createPredictableIds())).toEqual(example());
    expect(planFile.read("{not json", createPredictableIds())).toBe("not-a-plan");
    expect(planFile.read('{"name": "something else"}', createPredictableIds())).toBe("not-a-plan");
    expect(planFile.read("null", createPredictableIds())).toBe("not-a-plan");
    expect(planFile.read('{"version": 0}', createPredictableIds())).toBe("not-a-plan");
  });

  it("recognizes a plan file from a newer version", () => {
    expect(planFile.read('{"version": 2, "activities": []}', createPredictableIds())).toBe(
      "newer-version",
    );
  });
});
