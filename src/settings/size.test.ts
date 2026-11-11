import { describe, expect, it } from "vitest";

import { formatSize } from "./size.ts";

describe("sizes", () => {
  it("reads in kilobytes under a megabyte, in megabytes above", () => {
    const format = { locale: "en" };
    expect(formatSize(49_152, format)).toBe("49 kB");
    expect(formatSize(200, format)).toBe("1 kB");
    expect(formatSize(1_250_000, format)).toBe("1.3 MB");
    expect(formatSize(1_250_000, { locale: "de" })).toBe("1,3 MB");
  });
});
