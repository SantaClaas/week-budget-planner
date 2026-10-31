import { describe, expect, it } from "vitest";

import { createPath, createTitle, PAGES, read } from "./index.ts";

const BASE = "/week-budget-planner/";

describe("the page paths", () => {
  it("read back the page they were made for", () => {
    for (const page of PAGES) expect(read(createPath(page, BASE), BASE)).toBe(page);
  });

  it("put Week at the base itself", () => {
    expect(createPath("week", BASE)).toBe("/week-budget-planner/");
    expect(createPath("settings", BASE, "your-data")).toBe(
      "/week-budget-planner/settings#your-data",
    );
  });

  it("have no page outside the base, below a page or without the base's slash", () => {
    expect(read("/activities", BASE)).toBeUndefined();
    expect(read("/week-budget-planner", BASE)).toBeUndefined();
    expect(read("/week-budget-planner/settings/", BASE)).toBeUndefined();
    expect(read("/week-budget-planner/index.html", BASE)).toBeUndefined();
  });

  it("name the page first in the title", () => {
    expect(createTitle("activities")).toBe("Activities · Week Budget Planner");
  });
});
