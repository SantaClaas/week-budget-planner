/**
 * The app's pages and their paths under the base (see Pages and URLs in docs/spec/layout.md). The
 * functions here only read and build paths; src/page/history.ts moves between them.
 */

/** A page the navigation leads to. */
export type Destination = "week" | "activities" | "settings";

/** What an address shows: a destination, or "not-found" for a path under the base with no page. */
export type Page = Destination | "not-found";

/** Each destination's path after the base, which ends in a slash, so Week's is the base itself. */
const PATHS = {
  week: "",
  activities: "activities",
  settings: "settings",
} as const satisfies Record<Destination, string>;

/** The page's name, as its app bar headline says it, and for a destination its navigation link. */
export const NAMES = {
  week: "Week",
  activities: "Activities",
  settings: "Settings",
  "not-found": "Page not found",
} as const satisfies Record<Page, string>;

/** Every destination, in the order the navigation lists them. */
export const DESTINATIONS: readonly Destination[] = ["week", "activities", "settings"];

/**
 * The page a path shows, or undefined for a path outside the base, which isn't the app's. A
 * trailing slash and `index.html` are spellings of the same page; `createPath` gives its own.
 */
export function read(pathname: string, base: string): Page | undefined {
  // The base without its slash, as a typed address may end.
  if (`${pathname}/` === base) return "week";
  if (!pathname.startsWith(base)) return undefined;
  const rest = pathname
    .slice(base.length)
    .replace(/index\.html$/u, "")
    .replace(/\/$/u, "");
  return DESTINATIONS.find((destination) => PATHS[destination] === rest) ?? "not-found";
}

/** The destination's path under the base, with a section of it when `section` is given. */
export const createPath = (destination: Destination, base: string, section?: string): string =>
  `${base}${PATHS[destination]}${section === undefined ? "" : `#${section}`}`;

/** The document's title on the page. */
export const createTitle = (page: Page): string => `${NAMES[page]} · Week Budget Planner`;
