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

import { PALETTE } from "../src/plan/types.ts";

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

/** One activity color's tokens at one contrast level. */
function readActivityColors(contrastLevel: number, hue: number): Colors {
  const read = (role: DynamicColor): Pair =>
    readPair(contrastLevel, (scheme) => role.getArgb(withPrimaryHue(scheme, hue)));
  return [
    ["activity-container", read(Roles.primaryContainer)],
    ["on-activity-container", read(onActivityContainer)],
    ["activity-color", read(Roles.primary)],
  ];
}

/** A rule with `light-dark()` declarations, or with the light values only. */
function writeRule(
  selector: string,
  colors: Colors,
  indent: string,
  values: "light-dark" | "light",
): string[] {
  const declarations = colors.map(([token, { light, dark }]) =>
    values === "light" || light === dark
      ? `--${token}: ${light};`
      : `--${token}: light-dark(${light}, ${dark});`,
  );
  return [
    `${indent}${selector} {`,
    ...declarations.map((line) => `${indent}  ${line}`),
    `${indent}}`,
  ];
}

const aliasColors: Colors = ALIASES.map(([token, light, dark]) => [token, { light, dark }]);

/** Each contrast level, for the system setting and for the Contrast setting. */
function writeLevels(
  selectorFor: (root: string) => string,
  readColors: (level: number) => Colors,
): string[] {
  const lines: string[] = [];
  for (const { name, contrastLevel } of LEVELS) {
    const colors = readColors(contrastLevel);
    lines.push(
      `    @media (prefers-contrast: ${name}) {`,
      ...writeRule(selectorFor(":root:not([data-contrast])"), colors, "      ", "light-dark"),
      "    }",
      ...writeRule(selectorFor(`:root[data-contrast="${name}"]`), colors, "    ", "light-dark"),
    );
  }
  return lines;
}

/** The scheme's colors: standard on :root, the other levels, and the light fallback. */
export function writeSchemeColors(): string {
  const standard = readSchemeColors(STANDARD);
  return [
    ...writeRule(":root", [...standard, ...aliasColors], "  ", "light-dark"),
    "  @supports (color: light-dark(#000, #fff)) {",
    ...writeLevels((root) => root, readSchemeColors),
    "    /* The standard colors again, for what must stay readable at every level: the Contrast",
    "       setting itself (see Contrast in docs/spec/design.md). */",
    ...writeRule(".standard-contrast", [...standard, ...aliasColors], "    ", "light-dark"),
    "  }",
    "  /* Without light-dark() (Chrome 123, Firefox 120, Safari 17.5), every color above would be",
    "     invalid, so these browsers get the standard light colors. */",
    "  @supports not (color: light-dark(#000, #fff)) {",
    "    :root {",
    "      /* Light only, so native controls match the colors. */",
    "      color-scheme: light;",
    // Only what light-dark() sets: an alias that's the same in both is valid without it.
    ...writeRule(
      ":root",
      [...standard, ...aliasColors].filter(([, { light, dark }]) => light !== dark),
      "    ",
      "light",
    ).slice(1, -1),
    "    }",
    "  }",
  ].join("\n");
}

/** The activity colors: standard on each `.color-…` class, the other levels, and the fallback. */
export function writeActivityColors(): string {
  const palette = PALETTE.map(({ key, hue }) => ({ selector: `.color-${key}`, hue }));
  return [
    ...palette.flatMap(({ selector, hue }) =>
      writeRule(selector, readActivityColors(STANDARD, hue), "  ", "light-dark"),
    ),
    "  @supports (color: light-dark(#000, #fff)) {",
    ...palette.flatMap(({ selector, hue }) =>
      writeLevels(
        (root) => `${root} ${selector}`,
        (level) => readActivityColors(level, hue),
      ),
    ),
    "  }",
    "  /* Light colors where light-dark() is missing, as for the scheme. */",
    "  @supports not (color: light-dark(#000, #fff)) {",
    ...palette.flatMap(({ selector, hue }) =>
      writeRule(selector, readActivityColors(STANDARD, hue), "    ", "light"),
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
