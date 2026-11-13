import { describe, expect, it } from "vitest";

import { randomIds, sanitizeActivityId, sanitizeBlockId } from "./id.ts";

describe("id", () => {
  it("creates 12-character ids without lookalike characters", () => {
    const ids = [
      ...Array.from({ length: 100 }, randomIds.createActivityId),
      ...Array.from({ length: 100 }, randomIds.createBlockId),
    ];
    for (const id of ids) expect(id).toMatch(/^[6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz]{12}$/u);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ["an activity id", sanitizeActivityId],
    ["a block id", sanitizeBlockId],
  ])("keeps %s of 1 to 40 characters and refuses any other", (_, sanitize) => {
    expect(sanitize("x")).toBe("x");
    expect(sanitize("x".repeat(40))).toBe("x".repeat(40));
    expect(sanitize("")).toBeUndefined();
    expect(sanitize("x".repeat(41))).toBeUndefined();
  });
});
