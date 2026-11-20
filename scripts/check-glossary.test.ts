import { describe, expect, it } from "vitest";

import {
  checkRepository,
  describe as describeUse,
  findStaleExceptions,
  findUses,
  readGlossary,
  readWrongNames,
} from "./check-glossary.ts";

const GLOSSARY = [
  "| Term | Meaning | Wrong names (look-up only) | Notes |",
  "| --- | --- | --- | --- |",
  "| **Block** | One piece of an activity. | tile, event, wrapping block | Code: `Block` |",
  "| **Left to place** | Budget minus placed. | hours left, overbooked (for over budget) | |",
  "| **Export / Import** | Save the database. | save file / load file | |",
].join("\n");

const wrongNames = readWrongNames(GLOSSARY);

/** The wrong names a text uses, as `line: name`. */
const listUses = (text: string): string[] =>
  findUses(text, wrongNames).map(({ line, name }) => `${line.toString()}: ${name}`);

describe("the glossary's wrong names", () => {
  it("reads the wrong names of each term from the glossary's table", () => {
    expect(wrongNames).toEqual([
      { name: "tile", term: "Block" },
      { name: "event", term: "Block" },
      { name: "wrapping block", term: "Block" },
      { name: "hours left", term: "Left to place" },
      { name: "overbooked", term: "over budget" },
      { name: "save file", term: "Export / Import" },
      { name: "load file", term: "Export / Import" },
    ]);
  });

  it("finds a wrong name in any case, plural or not, with its line", () => {
    expect(listUses("Drag a block.\nDrag a Tile.\nTiles move.")).toEqual(["2: tile", "3: tile"]);
  });

  it("finds a wrong name inside an identifier", () => {
    expect(listUses("const tileCount = 1;\nconst TILE_LIMIT = 2;\n.tile-row {}")).toEqual([
      "1: tile",
      "2: tile",
      "3: tile",
    ]);
  });

  it("finds a name of several words written apart, hyphenated, joined or in camelCase", () => {
    expect(listUses("hours left\nhours-left\nhoursLeft\nwrappingBlock")).toEqual([
      "1: hours left",
      "2: hours left",
      "3: hours left",
      "4: wrapping block",
    ]);
  });

  it("doesn't find a wrong name inside another word", () => {
    expect(listUses("A textile, a projectile, untiled.")).toEqual([]);
  });

  it("lets a wrong name pass when it is the whole of a quote or a code span", () => {
    expect(listUses('Say "block" (never "tile"), not `tiles` or ‘Tile’.')).toEqual([]);
  });

  it("still finds a wrong name inside quoted copy", () => {
    expect(listUses('The button says "Drag the tile".')).toEqual(["1: tile"]);
  });

  it("leaves the wrong names too common to check to review", () => {
    expect(listUses("An event listener.")).toEqual([]);
  });

  it("knows every wrong name it leaves unchecked from the glossary", () => {
    expect(findStaleExceptions(readGlossary())).toEqual([]);
    expect(findStaleExceptions(wrongNames)).toContain("plan");
  });

  it("describes a use as file:line, the wrong name and the term", () => {
    expect(describeUse({ file: "src/a.ts", line: 3, name: "tile", term: "Block" })).toBe(
      'src/a.ts:3 "tile" is a wrong name: say "Block"',
    );
  });

  it("finds no wrong name in the repository (run pnpm glossary)", () => {
    expect(checkRepository().map((use) => describeUse(use))).toEqual([]);
  });
});
