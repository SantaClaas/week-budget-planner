import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// docs/design/m3-tokens.css sets every color as a variable per contrast level and points each token
// at one of them: the standard level on :root and on each activity color's class, and the other
// levels in `@supports (color: light-dark(...))` blocks, for the system setting and for
// data-contrast. Older browsers skip those blocks and read an `@supports not (...)` block with the
// light values instead. The tests resolve the variables the way the browser does.
const css = readFileSync(
  new URL("../docs/design/m3-tokens.css", import.meta.url),
  "utf8",
).replaceAll(/\/\*[\s\S]*?\*\//gu, "");
const FALLBACK_START = "@supports not (color: light-dark(#000, #fff))";
const LEVELS_START = "@supports (color: light-dark(#000, #fff))";
const HUES = ["blue", "red", "green", "amber", "violet", "teal", "pink", "lime"];
/** The rule that points every activity color's tokens at a level. */
const EVERY_COLOR = `:is(${HUES.map((hue) => `[data-color="${hue}"]`).join(", ")})`;

/** The first argument of `light-dark(first, second)`, allowing nested parentheses. */
function findLightValue(value: string): string {
  const inner = value.slice("light-dark(".length, -1);
  let depth = 0;
  for (let index = 0; index < inner.length; index++) {
    const character = inner[index];
    if (character === "," && depth === 0) return inner.slice(0, index).trim();
    if (character === "(") depth++;
    if (character === ")") depth--;
  }
  throw new Error(`Not a light-dark() value: ${value}`);
}

/** Splits the CSS into the blocks that start with `opening` and everything else. */
function splitBlocks(text: string, opening: string): { rest: string; blocks: string } {
  let rest = "";
  let blocks = "";
  let position = 0;
  for (let start = text.indexOf(opening); start >= 0; start = text.indexOf(opening, position)) {
    const end = text.indexOf("\n  }\n", start);
    rest += text.slice(position, start);
    blocks += text.slice(start, end);
    position = end;
  }
  return { rest: rest + text.slice(position), blocks };
}

/** Every rule's `--name: value;` declarations, keyed by its selector with the whitespace collapsed.
 * Later declarations win, as in the cascade. */
function readRules(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  for (const [, selector = "", body = ""] of text.matchAll(/([^{};]+)\{([^{}]*)\}/gu)) {
    const key = selector
      .replaceAll(/\s+/gu, " ")
      .replaceAll("( ", "(")
      .replaceAll(" )", ")")
      .trim();
    const declarations = rules.get(key) ?? new Map<string, string>();
    for (const [, name = "", value = ""] of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) {
      declarations.set(name, value.trim());
    }
    rules.set(key, declarations);
  }
  return rules;
}

const { rest: withoutFallbacks, blocks: fallbackText } = splitBlocks(css, FALLBACK_START);
const { rest: baseText, blocks: levelText } = splitBlocks(withoutFallbacks, LEVELS_START);
const base = readRules(baseText);
// The two media queries have the same selector inside, so their rules are keyed by the query too.
const levelRules = readRules(
  levelText.replaceAll(/@media \(prefers-contrast: (\w+)\) \{/gu, "@media $1 {\n@media-$1 "),
);

/** The rules that set `selector`'s colors outside the levels: its own, and for an activity color
 * the rule shared by all of them. */
function readBase(selector: string): Map<string, string> {
  const keys = selector === ":root" ? [":root"] : [selector, EVERY_COLOR];
  const declarations = new Map<string, string>();
  for (const key of keys) {
    const rule = base.get(key);
    if (!rule) throw new Error(`No rule for ${key}`);
    for (const [name, value] of rule) declarations.set(name, value);
  }
  return declarations;
}

/** Replaces every `var(--name)` with that variable's value, as the browser substitutes it. */
function resolve(declarations: Map<string, string>): Map<string, string> {
  const substitute = (value: string, depth: number): string =>
    depth > 10
      ? value
      : value.replaceAll(/var\((--[\w-]+)\)/gu, (match: string, name: string) => {
          const found = declarations.get(name);
          return found === undefined ? match : substitute(found, depth + 1);
        });
  return new Map([...declarations].map(([name, value]) => [name, substitute(value, 0)]));
}

/** What the fallback block must hold: the light value of every token that light-dark() sets,
 * outside the levels, keyed by selector and name. */
function findExpectedFallbacks(): Map<string, string> {
  const expected = new Map<string, string>();
  for (const selector of [":root", ...HUES.map((hue) => `[data-color="${hue}"]`)]) {
    const declarations = readBase(selector);
    for (const [name, declared] of declarations) {
      // the level variables themselves are only read through the tokens
      if (name.endsWith("-contrast")) continue;
      // a token that points at its standard level takes that level's value
      const pointedAt = /^var\((--[\w-]+-standard-contrast)\)$/u.exec(declared)?.[1];
      const value = pointedAt === undefined ? declared : (declarations.get(pointedAt) ?? declared);
      if (value.startsWith("light-dark(")) {
        expected.set(`${selector} ${name}`, findLightValue(value));
      }
    }
  }
  return expected;
}

/** A level's rules, for the Contrast setting and for the system setting, on :root and on the
 * activity colors. */
function findLevelRules(level: string): Map<string, string>[] {
  const roots = [`:root[data-contrast="${level}"]`, `@media-${level} :root:not([data-contrast])`];
  return roots.flatMap((root) =>
    [root, `${root} ${EVERY_COLOR}`].map((key) => {
      const rule = levelRules.get(key);
      if (!rule) throw new Error(`No rule for ${key}`);
      return rule;
    }),
  );
}

/** How many of a level's values on :root differ from the standard ones. A token that changes only
 * at the other level keeps its standard value at this one. */
function countOwnValues(level: string): number {
  const values = readBase(":root");
  return [...values.keys()].filter(
    (name) =>
      name.endsWith(`-${level}-contrast`) &&
      values.get(name) !== values.get(name.replace(`-${level}-`, "-standard-")),
  ).length;
}

describe("design tokens", () => {
  it("has a light fallback for every light-dark() color, and nothing else", () => {
    const expected = findExpectedFallbacks();
    const fallbacks = new Map(
      [...readRules(fallbackText)].flatMap(([selector, declarations]) =>
        [...declarations].map(([name, value]): [string, string] => [`${selector} ${name}`, value]),
      ),
    );
    expect(expected.size).toBeGreaterThan(50);
    expect(fallbacks).toEqual(expected);
  });

  it.each(["more", "less"])("points every token at its %s value in that level's rules", (level) => {
    for (const rule of findLevelRules(level)) {
      expect(rule.size).toBeGreaterThan(0);
      for (const [name, value] of rule) expect(value).toBe(`var(${name}-${level}-contrast)`);
    }
    expect(countOwnValues(level)).toBeGreaterThan(20);
  });
});

/** A color token's two values, from `light-dark(light, dark)`. */
interface ColorPair {
  light: string;
  dark: string;
}

/** The contrast levels that must meet WCAG AA. Less is below it on purpose, as an alternate
 * version the user opts into (see Contrast in docs/spec/design.md), and scripts/build-colors.test.ts
 * checks that it's Google's own level -1. */
type Level = "standard" | "more";
const AA_LEVELS: Level[] = ["standard", "more"];

/** The colors `selector` resolves to at a level: its rules, with the level's rules on top, and
 * every variable substituted. */
function readLevel(selector: string, level: Level): Map<string, ColorPair> {
  const declarations = readBase(selector);
  if (level !== "standard") {
    const root = `:root[data-contrast="${level}"]`;
    const key = selector === ":root" ? root : `${root} ${EVERY_COLOR}`;
    const rule = levelRules.get(key);
    if (!rule) throw new Error(`No rule for ${key}`);
    for (const [name, value] of rule) declarations.set(name, value);
  }
  const colors = new Map<string, ColorPair>();
  for (const [name, value] of resolve(declarations)) {
    const [, light, dark] = /^light-dark\((#[\da-f]{6}),\s*(#[\da-f]{6})\)$/u.exec(value) ?? [];
    if (light !== undefined && dark !== undefined) colors.set(name, { light, dark });
  }
  return colors;
}

/** One scheme's value of a color token, failing the test when the token is missing. */
function pickColor(colors: Map<string, ColorPair>, name: string, scheme: keyof ColorPair): string {
  const pair = colors.get(name);
  if (!pair) throw new Error(`No light-dark() color ${name}`);
  return pair[scheme];
}

/** Relative luminance as WCAG 2 defines it, from a `#rrggbb` color. */
function measureLuminance(color: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The WCAG 2 contrast ratio between two `#rrggbb` colors, from 1 to 21. */
function measureContrast(first: string, second: string): number {
  const [lighter, darker] = [measureLuminance(first), measureLuminance(second)].toSorted(
    (a, b) => b - a,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

// WCAG 2.2 AA: 4.5:1 for text (1.4.3), 3:1 for the parts of controls and graphics that carry
// meaning (1.4.11), such as a swatch, a progress bar's overrun or an outlined button's border.
const TEXT = 4.5;
const GRAPHIC = 3;

describe.each(AA_LEVELS)("color contrast, %s", (level) => {
  const theme = readLevel(":root", level);
  // The card isn't a light-dark() pair of its own: it's the lowest container in light and the
  // high one in dark (see Color in docs/spec/design.md).
  const lowest = theme.get("--surface-container-lowest");
  const high = theme.get("--surface-container-high");
  if (lowest && high) theme.set("--card", { light: lowest.light, dark: high.dark });

  // What sits on what, from the components in docs/design/m3-tokens.css.
  const pairs: [foreground: string, background: string, minimum: number][] = [
    ...[
      "--surface",
      "--surface-container",
      "--surface-container-low",
      "--surface-container-high",
      "--card",
    ].map((background): [string, string, number] => ["--on-surface", background, TEXT]),
    ...["--surface-container", "--surface-container-low", "--surface-container-high", "--card"].map(
      (background): [string, string, number] => ["--on-surface-variant", background, TEXT],
    ),
    ["--primary", "--surface-container", TEXT],
    ["--primary", "--card", TEXT],
    ["--on-primary", "--primary", TEXT],
    ["--on-primary-container", "--primary-container", TEXT],
    ["--on-secondary-container", "--secondary-container", TEXT],
    ["--on-tertiary-container", "--tertiary-container", TEXT],
    ["--on-error", "--error", TEXT],
    ["--on-error-container", "--error-container", TEXT],
    ["--error", "--card", TEXT],
    ["--success", "--card", TEXT],
    ["--inverse-on-surface", "--inverse-surface", TEXT],
    ["--inverse-primary", "--inverse-surface", TEXT],
    ["--over-budget", "--card", GRAPHIC],
    ["--outline", "--card", GRAPHIC],
    ["--outline", "--surface-container", GRAPHIC],
  ];

  it.each(
    pairs.flatMap(([foreground, background, minimum]) =>
      (["light", "dark"] as const).map((scheme) => ({ foreground, background, minimum, scheme })),
    ),
  )(
    "$foreground on $background ($scheme) reaches $minimum:1",
    ({ foreground, background, minimum, scheme }) => {
      const front = pickColor(theme, foreground, scheme);
      const back = pickColor(theme, background, scheme);
      expect(measureContrast(front, back)).toBeGreaterThanOrEqual(minimum);
    },
  );

  it.each(HUES.flatMap((hue) => (["light", "dark"] as const).map((scheme) => ({ hue, scheme }))))(
    "activity color $hue ($scheme): block text and swatch",
    ({ hue, scheme }) => {
      const activity = readLevel(`[data-color="${hue}"]`, level);
      const container = pickColor(activity, "--activity-container", scheme);
      const text = pickColor(activity, "--on-activity-container", scheme);
      const solid = pickColor(activity, "--activity-color", scheme);
      const card = pickColor(theme, "--card", scheme);
      // a block's name and time on its fill
      expect(measureContrast(text, container)).toBeGreaterThanOrEqual(TEXT);
      // the swatch and the progress bar on the card they sit on
      expect(measureContrast(solid, card)).toBeGreaterThanOrEqual(GRAPHIC);
    },
  );
});

it("measures contrast as WCAG does", () => {
  expect(measureContrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(measureContrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  expect(measureContrast("#ffffff", "#ffffff")).toBe(1);
});
