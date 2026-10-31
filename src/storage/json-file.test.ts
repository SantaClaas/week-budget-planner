import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import * as planFile from "../plan/file.ts";
import { createPredictableIds } from "../plan/test-data.ts";
import * as jsonFile from "./json-file.ts";
import { createExportName } from "./plan-store.ts";

const TODAY = Temporal.PlainDate.from("2026-10-15");

describe("export files", () => {
  it("names every export after the day it's made", () => {
    expect(createExportName(TODAY, "db")).toBe("week-budget-planner-2026-10-15.db");
    expect(createExportName(TODAY, "json")).toBe("week-budget-planner-2026-10-15.json");
  });

  it("saves the plan as a .json file in the stored format", async () => {
    const plan = createExampleWeek(
      Temporal.Instant.from("2026-10-15T08:00:00Z"),
      createPredictableIds(),
    );
    const file = jsonFile.create(plan, TODAY);
    expect(file.filename).toBe("week-budget-planner-2026-10-15.json");
    expect(file.blob.type).toBe("application/json");
    expect(await file.blob.text()).toBe(planFile.serialize(plan));
  });
});
