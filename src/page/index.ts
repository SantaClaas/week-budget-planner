/**
 * The app's pages and their paths under the base (see Pages and URLs in docs/spec/layout.md). The
 * functions here only read and build paths; src/page/history.ts moves between them.
 */

export type Page = "week" | "activities" | "settings";

/** Each page's path after the base, which ends in a slash, so Week's is the base itself. */
const PATHS = {
  week: "",
  activities: "activities",
  settings: "settings",
} as const satisfies Record<Page, string>;

/** The page's name, as its app bar headline and its link in the navigation say it. */
export const NAMES = {
  week: "Week",
  activities: "Activities",
  settings: "Settings",
} as const satisfies Record<Page, string>;

/** Every page, in the order the navigation lists them. */
export const PAGES: readonly Page[] = ["week", "activities", "settings"];

/** The page a path shows, or undefined for a path outside the base or with no page. */
export function read(pathname: string, base: string): Page | undefined {
  if (!pathname.startsWith(base)) return undefined;
  const rest = pathname.slice(base.length);
  return PAGES.find((page) => PATHS[page] === rest);
}

/** The page's path under the base, with a section of it when `section` is given. */
export const createPath = (page: Page, base: string, section?: string): string =>
  `${base}${PATHS[page]}${section === undefined ? "" : `#${section}`}`;

/** The document's title on the page. */
export const createTitle = (page: Page): string => `${NAMES[page]} · Week Budget Planner`;
