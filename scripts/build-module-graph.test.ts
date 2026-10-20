import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findCycles, findModule, readGraph, render } from "./build-module-graph.ts";

const edge = { isDynamic: false };

describe("the module graph", () => {
  it("names a module by its folder in src, or by its file there", () => {
    expect(findModule("plan/week.ts")).toBe("plan");
    expect(findModule("storage/database/index.ts")).toBe("storage");
    expect(findModule("App.tsx")).toBe("App");
    expect(findModule("color-scheme.ts")).toBe("color-scheme");
  });

  it("finds modules that import each other, directly or through others", () => {
    const graph = new Map([
      ["a", new Map([["b", edge]])],
      ["b", new Map([["c", edge]])],
      ["c", new Map([["a", edge]])],
      ["d", new Map([["a", edge]])],
    ]);
    expect(findCycles(graph)).toEqual([["a", "b", "c"]]);
  });

  it("finds no cycle where dependencies go one way", () => {
    const graph = new Map([
      ["a", new Map([["b", edge]])],
      ["b", new Map([["c", edge]])],
    ]);
    expect(findCycles(graph)).toEqual([]);
  });

  it("has no cycles between the app's modules", () => {
    expect(findCycles(readGraph())).toEqual([]);
  });

  it("is drawn in docs/MODULES.md as the imports are now (run pnpm modules)", () => {
    const drawn = readFileSync(new URL("../docs/MODULES.md", import.meta.url), "utf8");
    expect(drawn).toBe(render(readGraph()));
  });
});
