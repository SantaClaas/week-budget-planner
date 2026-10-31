import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { build, OUTPUTS } from "./build-iconset.ts";

describe("the iconset", () => {
  it("is built from icons/icons.json as it is now (run pnpm icons)", async () => {
    const { iconset, names } = await build();
    expect(await readFile(OUTPUTS.iconset, "utf8"), "Run `pnpm icons`.").toBe(iconset);
    expect(await readFile(OUTPUTS.names, "utf8"), "Run `pnpm icons`.").toBe(names);
  });
});
