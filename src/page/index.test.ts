import { describe, expect, it } from "vitest";

import { createPath, createTitle, DESTINATIONS, read } from "./index.ts";

const BASE = "/week-budget-planner/";

describe("the page paths", () => {
  it("read back the destination they were made for", () => {
    for (const destination of DESTINATIONS) {
      expect(read(createPath(destination, BASE), BASE)).toBe(destination);
    }
  });

  it("put Week at the base itself", () => {
    expect(createPath("week", BASE)).toBe("/week-budget-planner/");
    expect(createPath("settings", BASE, "your-data")).toBe(
      "/week-budget-planner/settings#your-data",
    );
  });

  it("read a trailing slash, index.html and the base without its slash as the same page", () => {
    expect(read("/week-budget-planner/settings/", BASE)).toBe("settings");
    expect(read("/week-budget-planner/index.html", BASE)).toBe("week");
    expect(read("/week-budget-planner", BASE)).toBe("week");
  });

  it("find no page at an unknown path under the base, or below a page", () => {
    expect(read("/week-budget-planner/no-such-page", BASE)).toBe("not-found");
    expect(read("/week-budget-planner/settings/more", BASE)).toBe("not-found");
  });

  it("leave a path outside the base alone", () => {
    expect(read("/activities", BASE)).toBeUndefined();
    expect(read("/other-project/", BASE)).toBeUndefined();
  });

  it("name the page first in the title", () => {
    expect(createTitle("activities")).toBe("Activities · Week Budget Planner");
    expect(createTitle("not-found")).toBe("Page not found · Week Budget Planner");
  });
});
