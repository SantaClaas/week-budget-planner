import { describe, expect, it } from "vitest";

import { createActivityId, createBlockId } from "./id.ts";

describe("id", () => {
  it("creates 12-character ids without lookalike characters", () => {
    const ids = [
      ...Array.from({ length: 100 }, createActivityId),
      ...Array.from({ length: 100 }, createBlockId),
    ];
    for (const id of ids) expect(id).toMatch(/^[6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz]{12}$/u);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
