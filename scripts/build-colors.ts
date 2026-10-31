// Builds the colors in docs/design/m3-tokens.css with Google's material-color-utilities: the
// SchemeTonalSpot scheme from the seed, the success and over-budget colors, and an activity color
// for each palette hue, each at three of the library's contrast levels (see Color and Contrast in
// docs/spec/design.md).
//
//   node scripts/build-colors.ts
//
// Only the parts of the tokens file between the generated markers are rewritten. Each level is
// written twice: under @media (prefers-contrast: …) for :root:not([data-contrast]), and for
// :root[data-contrast="…"], which the inline script in index.html sets from the Contrast setting.
// The levels need light-dark(), so they sit inside @supports for it, and older browsers keep the
// standard light colors from the fallback block.

import { readFileSync, writeFileSync } from "node:fs";

import {
  DynamicColor,
  DynamicScheme,
  Hct,
  MaterialDynamicColors as Roles,
  SchemeTonalSpot,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

import { PALETTE } from "../src/plan/activity/look.ts";

const tokensFile = new URL("../docs/design/m3-tokens.css", import.meta.url);

/** A cobalt close to the prototype's accent (see Color in docs/spec/design.md). */
const SEED = "#3a5bd9";
/** The chroma of every activity color's tonal palette. */
const ACTIVITY_CHROMA = 48;

/** The library's contrast levels the app offers, under the names the Contrast setting stores. */
const LEVELS = [
  { name: "more", contrastLevel: 1 },
  { name: "less", contrastLevel: -1 },
] as const;
const STANDARD = 0;

/** The roles the components use, in the order the tokens file lists them. */
const SCHEME_ROLES: [token: string, role: DynamicColor][] = [
  ["primary", Roles.primary],
  ["on-primary", Roles.onPrimary],
  ["primary-container", Roles.primaryContainer],
  ["on-primary-container", Roles.onPrimaryContainer],
  ["secondary", Roles.secondary],
  ["secondary-container", Roles.secondaryContainer],
  ["on-secondary-container", Roles.onSecondaryContainer],
  ["tertiary", Roles.tertiary],
  ["tertiary-container", Roles.tertiaryContainer],
  ["on-tertiary-container", Roles.onTertiaryContainer],
  ["error", Roles.error],
  ["on-error", Roles.onError],
  ["error-container", Roles.errorContainer],
  ["on-error-container", Roles.onErrorContainer],
  ["surface", Roles.surface],
  ["on-surface", Roles.onSurface],
  ["on-surface-variant", Roles.onSurfaceVariant],
  ["surface-container-lowest", Roles.surfaceContainerLowest],
  ["surface-container-low", Roles.surfaceContainerLow],
  ["surface-container", Roles.surfaceContainer],
  ["surface-container-high", Roles.surfaceContainerHigh],
  ["surface-container-highest", Roles.surfaceContainerHighest],
  ["outline", Roles.outline],
  ["outline-variant", Roles.outlineVariant],
  ["inverse-surface", Roles.inverseSurface],
  ["inverse-on-surface", Roles.inverseOnSurface],
  ["inverse-primary", Roles.inversePrimary],
];

/** The package doesn't export the ContrastCurve class or its type, so this takes it from a role. */
type ContrastCurve = NonNullable<DynamicColor["contrastCurve"]>;

function requireCurve(role: DynamicColor): ContrastCurve {
  if (!role.contrastCurve) throw new Error(`${role.name} has no contrast curve.`);
  return role.contrastCurve;
}

/** The overrun in progress bars: the error palette at tone 40 in light and 60 in dark, so it reads
 * as red in both. It's a graphic, not text, so it keeps the contrast curve of `outline`, the role
 * for graphics on the surface (3:1 at standard). */
const overBudget = DynamicColor.fromPalette({
  name: "over_budget",
  palette: (scheme) => scheme.errorPalette,
  tone: (scheme) => (scheme.isDark ? 60 : 40),
  background: (scheme) => Roles.highestSurface(scheme),
  contrastCurve: requireCurve(Roles.outline),
});

/** Text on an activity's container, at tone 10 in light and 90 in dark, held to the contrast curve
 * of `onPrimaryContainer`. The activity's palette is the scheme's primary palette. */
const onActivityContainer = DynamicColor.fromPalette({
  name: "on_activity_container",
  palette: (scheme) => scheme.primaryPalette,
  tone: (scheme) => (scheme.isDark ? 90 : 10),
  background: () => Roles.primaryContainer,
  contrastCurve: requireCurve(Roles.onPrimaryContainer),
});

/** Tokens that name another token. They're written wherever the colors are set on an element other
 * than :root, since a var() resolves where it's declared. */
const ALIASES: [token: string, light: string, dark: string][] = [
  ["card", "var(--surface-container-lowest)", "var(--surface-container-high)"],
  ["weekend", "var(--surface-container-low)", "var(--surface-container-low)"],
];

type Pair = { light: string; dark: string };
type Colors = [token: string, pair: Pair][];

const seed = Hct.fromInt(argbFromHex(SEED));

/** The same scheme with an activity's palette as its primary palette, so the primary roles give
 * that activity's colors with the library's own rules for containers. */
function withPrimaryHue(scheme: DynamicScheme, hue: number): DynamicScheme {
  return new DynamicScheme({
    sourceColorArgb: scheme.sourceColorArgb,
    variant: scheme.variant,
    contrastLevel: scheme.contrastLevel,
    isDark: scheme.isDark,
    primaryPalette: TonalPalette.fromHueAndChroma(hue, ACTIVITY_CHROMA),
    secondaryPalette: scheme.secondaryPalette,
    tertiaryPalette: scheme.tertiaryPalette,
    neutralPalette: scheme.neutralPalette,
    neutralVariantPalette: scheme.neutralVariantPalette,
  });
}

function readPair(
  contrastLevel: number,
  color: (scheme: DynamicScheme) => number,
): { light: string; dark: string } {
  return {
    light: hexFromArgb(color(new SchemeTonalSpot(seed, false, contrastLevel))),
    dark: hexFromArgb(color(new SchemeTonalSpot(seed, true, contrastLevel))),
  };
}

/** The scheme's tokens at one contrast level. "All placed" uses the green activity color. */
function readSchemeColors(contrastLevel: number): Colors {
  const green = PALETTE.find((color) => color.key === "green");
  if (!green) throw new Error("The palette has no green.");
  return [
    ...SCHEME_ROLES.map(([token, role]): [string, Pair] => [
      token,
      readPair(contrastLevel, (scheme) => role.getArgb(scheme)),
    ]),
    [
      "success",
      readPair(contrastLevel, (scheme) => Roles.primary.getArgb(withPrimaryHue(scheme, green.hue))),
    ],
    ["over-budget", readPair(contrastLevel, (scheme) => overBudget.getArgb(scheme))],
  ];
}

/** One activity color's tokens at one contrast level. The activity color itself (the swatch, the
 * progress bar) stays at its standard tone at every level: the library darkens or lightens it so far
 * at more contrast that the eight colors become hard to tell apart, and the standard tones already
 * reach 3:1 on the card at every level (an approved deviation, see Deviations in
 * docs/spec/design.md). */
function readActivityColors(contrastLevel: number, hue: number): Colors {
  const read = (role: DynamicColor, level = contrastLevel): Pair =>
    readPair(level, (scheme) => role.getArgb(withPrimaryHue(scheme, hue)));
  return [
    ["activity-container", read(Roles.primaryContainer)],
    ["on-activity-container", read(onActivityContainer)],
    ["activity-color", read(Roles.primary, STANDARD)],
  ];
}

/** A color as a CSS value: `light-dark()`, or one value when light and dark are the same. */
const writeValue = ({ light, dark }: Pair): string =>
  light === dark ? light : `light-dark(${light}, ${dark})`;

/** The variable that holds a token's value at one contrast level. */
const levelToken = (token: string, level: string): string => `--${token}-${level}-contrast`;

/** A rule with the given declarations. */
function writeRule(selector: string, declarations: string[], indent: string): string[] {
  return [
    `${indent}${selector} {`,
    ...declarations.map((line) => `${indent}  ${line}`),
    `${indent}}`,
  ];
}

const aliasColors: Colors = ALIASES.map(([token, light, dark]) => [token, { light, dark }]);

/** One set of colors (the scheme's, or one activity color's) at every level. */
type Levels = { standard: Colors; levels: { name: string; colors: Colors }[] };

function readLevels(readColors: (level: number) => Colors): Levels {
  return {
    standard: readColors(STANDARD),
    levels: LEVELS.map(({ name, contrastLevel }) => ({ name, colors: readColors(contrastLevel) })),
  };
}

/** The tokens whose value changes at some level, in the order they're listed. */
function findChangingTokens(sets: Levels[]): string[] {
  const changing = new Set<string>();
  for (const { standard, levels } of sets) {
    const standardValues = new Map(standard.map(([token, pair]) => [token, writeValue(pair)]));
    for (const { colors } of levels) {
      for (const [token, pair] of colors) {
        if (standardValues.get(token) !== writeValue(pair)) changing.add(token);
      }
    }
  }
  return sets[0]?.standard.map(([token]) => token).filter((token) => changing.has(token)) ?? [];
}

/** The values: a variable per level for each token that changes, the value itself for the rest. */
function writeValues({ standard, levels }: Levels, changing: string[]): string[] {
  return standard.flatMap(([token, pair]) => {
    if (!changing.includes(token)) return [`--${token}: ${writeValue(pair)};`];
    const atLevels = levels.map(({ name, colors }) => {
      const value = colors.find(([other]) => other === token)?.[1] ?? pair;
      return `${levelToken(token, name)}: ${writeValue(value)};`;
    });
    return [`${levelToken(token, "standard")}: ${writeValue(pair)};`, ...atLevels];
  });
}

/** Points each changing token at its value for one level. */
const pointAt = (changing: string[], level: string): string[] =>
  changing.map((token) => `--${token}: var(${levelToken(token, level)});`);

/** The rules that switch to each level: under the media query for the system setting, and for
 * `data-contrast` from the Contrast setting. `selectorFor` gets the root's selector and the rule's
 * indent. */
function writeLevelRules(
  selectorFor: (root: string, indent: string) => string,
  changing: string[],
): string[] {
  const lines: string[] = [];
  for (const { name } of LEVELS) {
    lines.push(
      `    @media (prefers-contrast: ${name}) {`,
      ...writeRule(
        selectorFor(":root:not([data-contrast])", "      "),
        pointAt(changing, name),
        "      ",
      ),
      "    }",
      ...writeRule(
        selectorFor(`:root[data-contrast="${name}"]`, "    "),
        pointAt(changing, name),
        "    ",
      ),
    );
  }
  return lines;
}

/** `:is()` over the activity color classes, one per line, as oxfmt lays out a long selector list
 * (so the formatter leaves the generated file as it is). */
function writeEveryColor(selectors: string[], indent: string): string {
  return [
    `:is(`,
    ...selectors.map(
      (selector, index) => `${indent}  ${selector}${index < selectors.length - 1 ? "," : ""}`,
    ),
    `${indent})`,
  ].join("\n");
}

/** The light value of every token that light-dark() sets, for browsers without it. */
const writeLightValues = (colors: Colors): string[] =>
  colors
    .filter(([, { light, dark }]) => light !== dark)
    .map(([token, { light }]) => `--${token}: ${light};`);

/** The scheme's colors: each value once on :root, the rules that pick a level, and the light
 * fallback. */
export function writeSchemeColors(): string {
  const scheme = readLevels(readSchemeColors);
  const changing = findChangingTokens([scheme]);
  const aliases = aliasColors.map(([token, pair]) => `--${token}: ${writeValue(pair)};`);
  return [
    ...writeRule(
      ":root",
      [...writeValues(scheme, changing), ...pointAt(changing, "standard"), ...aliases],
      "  ",
    ),
    "  @supports (color: light-dark(#000, #fff)) {",
    ...writeLevelRules((root) => root, changing),
    "    /* The standard colors again, for what must stay readable at every level: the Contrast",
    "       setting itself (see Contrast in docs/spec/design.md). The aliases are set again too,",
    "       since a var() resolves where it's declared. */",
    ...writeRule(".standard-contrast", [...pointAt(changing, "standard"), ...aliases], "    "),
    "  }",
    "  /* Without light-dark() (Chrome 123, Firefox 120, Safari 17.5), every color above would be",
    "     invalid, so these browsers get the standard light colors. */",
    "  @supports not (color: light-dark(#000, #fff)) {",
    ...writeRule(
      ":root",
      [
        "/* Light only, so native controls match the colors. */",
        "color-scheme: light;",
        ...writeLightValues([...scheme.standard, ...aliasColors]),
      ],
      "    ",
    ),
    "  }",
  ].join("\n");
}

/** The activity colors: each color's values once on its `[data-color="…"]` rule, named by the
 * palette's key, one set of rules for all of them that picks the level, and the light fallback. */
export function writeActivityColors(): string {
  const palette = PALETTE.map(({ key, hue }) => ({
    selector: `[data-color="${key}"]`,
    colors: readLevels((level) => readActivityColors(level, hue)),
  }));
  const changing = findChangingTokens(palette.map(({ colors }) => colors));
  const selectors = palette.map(({ selector }) => selector);
  return [
    ...palette.flatMap(({ selector, colors }) =>
      writeRule(selector, writeValues(colors, changing), "  "),
    ),
    ...writeRule(writeEveryColor(selectors, "  "), pointAt(changing, "standard"), "  "),
    "  @supports (color: light-dark(#000, #fff)) {",
    ...writeLevelRules(
      (root, indent) => `${root}\n${indent}  ${writeEveryColor(selectors, `${indent}  `)}`,
      changing,
    ),
    "  }",
    "  /* Light colors where light-dark() is missing, as for the scheme. */",
    "  @supports not (color: light-dark(#000, #fff)) {",
    ...palette.flatMap(({ selector, colors }) =>
      writeRule(selector, writeLightValues(colors.standard), "    "),
    ),
    "  }",
  ].join("\n");
}

/** The generated regions of the tokens file: the text between each pair of markers. */
const REGIONS = [
  { name: "the scheme's colors", write: writeSchemeColors },
  { name: "the activity colors", write: writeActivityColors },
];

const startMarker = (name: string): string =>
  `  /* Start of ${name}, generated by scripts/build-colors.ts (pnpm colors). */\n`;
const endMarker = (name: string): string => `  /* End of ${name}. */\n`;

/** The tokens file with every generated region written anew. */
export function writeTokens(text: string): string {
  let result = text;
  for (const { name, write } of REGIONS) {
    const start = result.indexOf(startMarker(name));
    const end = result.indexOf(endMarker(name));
    if (start < 0 || end < start) throw new Error(`The tokens file has no markers for ${name}.`);
    result = `${result.slice(0, start + startMarker(name).length)}${write()}\n${result.slice(end)}`;
  }
  return result;
}

if (import.meta.main) {
  writeFileSync(tokensFile, writeTokens(readFileSync(tokensFile, "utf8")));
  console.log("Wrote the colors in docs/design/m3-tokens.css");
}
