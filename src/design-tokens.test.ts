import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// docs/design/m3-tokens.css repeats the light value of every light-dark() color in an
// `@supports not (color: light-dark(...))` block for older browsers. This keeps the two the same.
const css = readFileSync(new URL("../docs/design/m3-tokens.css", import.meta.url), "utf8");
const FALLBACK_START = "@supports not (color: light-dark(#000, #fff))";

/** The first argument of `light-dark(first, second)`, allowing nested parentheses. */
function findLightValue(value: string): string {
  const inner = value.slice("light-dark(".length, -1);
  let depth = 0;
  for (let index = 0; index < inner.length; index++) {
    const character = inner[index];
    if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === "," && depth === 0) return inner.slice(0, index).trim();
  }
  throw new Error(`Not a light-dark() value: ${value}`);
}

/** Every `--name: value;` declaration in `text`, keyed by its selector and name. */
function readDeclarations(text: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const [, selector = "", body = ""] of text.matchAll(
    /([.:][\w-]+(?:\[[^\]]*\])?)\s*\{([^{}]*)\}/gu,
  )) {
    for (const [, name = "", value = ""] of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
      declarations.set(`${selector} ${name}`, value.trim());
    }
  }
  return declarations;
}

/** Splits the CSS into the fallback blocks and everything else. */
function splitFallbacks(text: string): { rest: string; fallbacks: string } {
  let rest = "";
  let fallbacks = "";
  let position = 0;
  for (
    let start = text.indexOf(FALLBACK_START);
    start >= 0;
    start = text.indexOf(FALLBACK_START, position)
  ) {
    const end = text.indexOf("\n  }\n", start);
    rest += text.slice(position, start);
    fallbacks += text.slice(start, end);
    position = end;
  }
  return { rest: rest + text.slice(position), fallbacks };
}

describe("design tokens", () => {
  it("has a light fallback for every light-dark() color, and nothing else", () => {
    const { rest, fallbacks } = splitFallbacks(css);
    const expected = new Map(
      [...readDeclarations(rest)]
        .filter(([, value]) => value.startsWith("light-dark("))
        .map(([key, value]) => [key, findLightValue(value)]),
    );
    expect(expected.size).toBeGreaterThan(30);
    expect(readDeclarations(fallbacks)).toEqual(expected);
  });
});
