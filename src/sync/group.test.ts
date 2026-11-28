import { describe, expect, it } from "vitest";

import { parseGroupId } from "./group.ts";

describe("group id", () => {
  it("accepts 32 lowercase hexadecimal digits", () => {
    const valid = "0123456789abcdef0123456789abcdef";
    expect(parseGroupId(valid)).toBe(valid);
  });

  it("refuses wrong lengths, uppercase, non-hex characters and non-strings", () => {
    expect(parseGroupId("")).toBeUndefined();
    expect(parseGroupId("a".repeat(31))).toBeUndefined();
    expect(parseGroupId("a".repeat(33))).toBeUndefined();
    expect(parseGroupId("A".repeat(32))).toBeUndefined();
    expect(parseGroupId(`${"a".repeat(31)}g`)).toBeUndefined();
    expect(parseGroupId(123)).toBeUndefined();
    expect(parseGroupId(null)).toBeUndefined();
    expect(parseGroupId({ toString: () => "0123456789abcdef0123456789abcdef" })).toBeUndefined();
  });
});
