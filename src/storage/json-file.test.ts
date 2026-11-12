import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import * as planFile from "../plan/file.ts";
import { createPredictableIds } from "../plan/test-data.ts";
import * as jsonFile from "./json-file.ts";
import { createExportName } from "./plan-store.ts";

const AT = Temporal.PlainDateTime.from("2026-10-15T09:05:07");

describe("export files", () => {
  it("names every export after the local date and time it's made, to the second", () => {
    expect(createExportName(AT, "db")).toBe("week-budget-planner-2026-10-15-09-05-07.db");
    expect(createExportName(AT, "json")).toBe("week-budget-planner-2026-10-15-09-05-07.json");
    // A second later on the same day, another name, which sorts after the first.
    const later = createExportName(AT.add({ seconds: 1 }), "db");
    expect(later).toBe("week-budget-planner-2026-10-15-09-05-08.db");
    expect([later, createExportName(AT, "db")].toSorted()[1]).toBe(later);
    // Late in the evening, the hour has two digits and no colon, which Windows refuses.
    expect(createExportName(Temporal.PlainDateTime.from("2026-12-31T23:59:59"), "db")).toBe(
      "week-budget-planner-2026-12-31-23-59-59.db",
    );
  });

  it("saves the plan as a .json file in the stored format", async () => {
    const plan = createExampleWeek(
      Temporal.Instant.from("2026-10-15T08:00:00Z"),
      createPredictableIds(),
    );
    const file = jsonFile.create(plan, AT);
    expect(file.filename).toBe("week-budget-planner-2026-10-15-09-05-07.json");
    expect(file.blob.type).toBe("application/json");
    expect(await file.blob.text()).toBe(planFile.serialize(plan));
  });
});
