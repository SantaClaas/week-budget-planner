import { describe, expect, it } from "vitest";

import * as saveStatus from "./save-status.ts";

describe("the save status", () => {
  it("says where the plan is saved", () => {
    expect(saveStatus.describe("full", "saved", false).text).toBe("Saved in this browser");
    expect(saveStatus.describe("limited", "saved", false).text).toBe("Saved in limited storage");
    expect(saveStatus.describe("full", "saving", false).text).toBe("Saving…");
  });

  it("reads Not saved without storage, after a failed save and in an outdated tab", () => {
    expect(saveStatus.describe("none", "saved", false).text).toBe("Not saved");
    expect(saveStatus.describe("none", "saving", false).text).toBe("Not saved");
    expect(saveStatus.describe("full", "failed", false).text).toBe("Not saved");
    expect(saveStatus.describe("full", "saved", true).text).toBe("Not saved");
  });
});
