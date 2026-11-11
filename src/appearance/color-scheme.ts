import * as preference from "./preference.ts";

/**
 * The color scheme the page uses, which the Settings page calls the theme: follow the system, or
 * always light or dark. The values are the CSS `color-scheme` values, and "light dark" follows the
 * system. Applying it sets the color-scheme meta, which the tokens map onto the CSS color-scheme
 * (see Theme in docs/spec/design.md).
 */
export type ColorScheme = "light dark" | "light" | "dark";

type ColorSchemeMeta = { content: string };

export const colorScheme = preference.create<ColorScheme, ColorSchemeMeta>({
  key: "week-budget-planner.color-scheme",
  choices: ["light dark", "light", "dark"],
  system: "light dark",
  findTarget: () =>
    globalThis.document?.querySelector<HTMLMetaElement>('meta[name="color-scheme"]') ?? undefined,
  apply: (meta, choice) => {
    meta.content = choice;
  },
});
