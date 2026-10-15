/** Minutes per slot. Every start and length snaps to it. */
export const SLOT = 15;
/** Minutes in a day. */
export const DAY = 1440;
/** Minutes in the week. The week wraps: Sunday night continues into Monday morning. */
export const WEEK = 7 * DAY;
/** The longest a block can be. */
export const MAX_LENGTH = DAY;
/** Default length for activities counted per week: one lecture slot. */
export const WEEKLY_DEFAULT_LENGTH = 90;

export type Mode = "week" | "day";

export type Activity = {
  id: string;
  /** At most 60 characters. */
  name: string;
  /** One of the palette hues, see {@link PALETTE}. */
  hue: number;
  /** One of the Material shape names, see {@link SHAPES}. */
  shape: string;
  /** How the budget is counted. */
  mode: Mode;
  /** Budget in minutes, per week or per day. A multiple of the slot, at least one slot. */
  budgetMinutes: number;
  /** Days per week, 1 to 7. Used only when `mode` is "day". */
  days: number;
};

export type Block = {
  id: string;
  /** The activity's id. */
  activityId: string;
  /** 0 is Monday, 6 is Sunday. */
  day: number;
  /** Minutes from midnight, 0 to 1425, a multiple of the slot. */
  start: number;
  /** Length in minutes, 15 to 1440. `start + length` may pass midnight (an overnight block). */
  length: number;
};

export type Plan = {
  version: 1;
  activities: Activity[];
  blocks: Block[];
  /** First of the day hours, 0 to 12. */
  dayStart: number;
  /** End of the day hours, 13 to 24. */
  dayEnd: number;
  /** True while the example week is loaded and not yet kept or replaced. */
  example: boolean;
};

/** The eight activity colors, keyed by the stored hue value. */
export const PALETTE = [
  { hue: 255, name: "Blue", key: "blue" },
  { hue: 28, name: "Red", key: "red" },
  { hue: 152, name: "Green", key: "green" },
  { hue: 78, name: "Amber", key: "amber" },
  { hue: 305, name: "Violet", key: "violet" },
  { hue: 198, name: "Teal", key: "teal" },
  { hue: 350, name: "Pink", key: "pink" },
  { hue: 118, name: "Lime", key: "lime" },
] as const;

/** All 35 shapes of Google's Material 3 Expressive shape library (see docs/design/m3-shapes.css). */
export const SHAPES = [
  "circle",
  "square",
  "slanted",
  "arch",
  "fan",
  "arrow",
  "semi-circle",
  "oval",
  "pill",
  "triangle",
  "diamond",
  "clam-shell",
  "pentagon",
  "gem",
  "sunny",
  "very-sunny",
  "cookie-4",
  "cookie-6",
  "cookie-7",
  "cookie-9",
  "cookie-12",
  "ghostish",
  "clover-4",
  "clover-8",
  "burst",
  "soft-burst",
  "boom",
  "soft-boom",
  "flower",
  "puffy",
  "puffy-diamond",
  "pixel-circle",
  "pixel-triangle",
  "bun",
  "heart",
] as const;

/**
 * The shapes new activities get by default: the library minus the ones that are hard to tell apart
 * when small, ordered so neighbours look different. The order is part of the spec; don't sort it.
 */
export const DEFAULT_SHAPES = [
  "circle",
  "heart",
  "triangle",
  "cookie-4",
  "arch",
  "clover-4",
  "diamond",
  "sunny",
  "pill",
  "gem",
  "fan",
  "cookie-6",
  "slanted",
  "flower",
  "pentagon",
  "burst",
  "semi-circle",
  "clover-8",
  "arrow",
  "puffy",
  "square",
  "cookie-9",
  "ghostish",
  "soft-burst",
  "oval",
  "very-sunny",
  "clam-shell",
  "puffy-diamond",
  "bun",
  "cookie-12",
] as const satisfies readonly (typeof SHAPES)[number][];

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_NAMES_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function emptyPlan(): Plan {
  return { version: 1, activities: [], blocks: [], dayStart: 7, dayEnd: 22, example: false };
}
