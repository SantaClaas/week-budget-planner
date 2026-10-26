import { describe, expect, it } from "vitest";

import { parseActivityName, sanitizeActivityName } from "./activity-name.ts";

describe("parseActivityName", () => {
  it("trims the name", () => {
    expect(parseActivityName("  Gym ")).toBe("Gym");
  });

  it("refuses a name of only spaces", () => {
    expect(parseActivityName("")).toBe("empty");
    expect(parseActivityName(" \t ")).toBe("empty");
  });

  it("cuts a long name to 60 characters, without a space at the end", () => {
    expect(parseActivityName("a".repeat(70))).toBe("a".repeat(60));
    expect(parseActivityName(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });

  it("counts an emoji as one character, like the database", () => {
    // Each is two UTF-16 units, so a cut by units would keep 30 and split none or half of one.
    expect(parseActivityName("🏋".repeat(61))).toBe("🏋".repeat(60));
  });

  it("keeps or drops an emoji of several code points as a whole", () => {
    // The flag is two code points: at 59 characters, only one of them would fit.
    expect(parseActivityName(`${"a".repeat(59)}🇩🇪`)).toBe("a".repeat(59));
    expect(parseActivityName(`${"a".repeat(58)}🇩🇪`)).toBe(`${"a".repeat(58)}🇩🇪`);
  });
});

describe("sanitizeActivityName", () => {
  it("keeps a valid name and cuts a long one", () => {
    expect(sanitizeActivityName(" Work ")).toBe("Work");
    expect(sanitizeActivityName("a".repeat(70))).toBe("a".repeat(60));
  });

  it("names an activity without a name Untitled", () => {
    expect(sanitizeActivityName("   ")).toBe("Untitled");
  });
});
