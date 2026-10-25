import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { writeTokens } from "./build-colors.ts";

it("has the colors in docs/design/m3-tokens.css that the library gives (run pnpm colors)", () => {
  const tokens = readFileSync(new URL("../docs/design/m3-tokens.css", import.meta.url), "utf8");
  expect(writeTokens(tokens)).toBe(tokens);
});
