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

/** A color token's two values, from `light-dark(light, dark)`. */
interface ColorPair {
  light: string;
  dark: string;
}

/** Every `--name: light-dark(#light, #dark);` declaration in `text`. */
function readColors(text: string): Map<string, ColorPair> {
  const colors = new Map<string, ColorPair>();
  for (const [, name = "", light = "", dark = ""] of text.matchAll(
    /(--[\w-]+):\s*light-dark\((#[\da-f]{6}),\s*(#[\da-f]{6})\);/gu,
  )) {
    colors.set(name, { light, dark });
  }
  return colors;
}

/** The text of every rule for `selector`, each up to its closing brace. */
function findRules(selector: string): string {
  let text = "";
  for (
    let start = css.indexOf(`  ${selector} {\n`);
    start >= 0;
    start = css.indexOf(`  ${selector} {\n`, start + 1)
  ) {
    text += css.slice(start, css.indexOf("\n  }\n", start));
  }
  if (text === "") throw new Error(`No rule for ${selector}`);
  return text;
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

describe("color contrast", () => {
  const theme = readColors(findRules(":root"));
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

  const hues = ["blue", "red", "green", "amber", "violet", "teal", "pink", "lime"];
  it.each(hues.flatMap((hue) => (["light", "dark"] as const).map((scheme) => ({ hue, scheme }))))(
    "activity color $hue ($scheme): block text and swatch",
    ({ hue, scheme }) => {
      const activity = readColors(findRules(`.color-${hue}`));
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

  it("measures contrast as WCAG does", () => {
    expect(measureContrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(measureContrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(measureContrast("#ffffff", "#ffffff")).toBe(1);
  });
});
