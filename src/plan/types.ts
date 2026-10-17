import type { ActivityId, BlockId } from "./id.ts";
import {
  sanitizeDayEnd,
  sanitizeDayStart,
  type BudgetMinutes,
  type DayCount,
  type DayIndex,
  type DayMinute,
  type Hour,
  type Length,
} from "./time.ts";

export type Mode = "week" | "day";

export type Activity = {
  id: ActivityId;
  /** At most 60 characters. */
  name: string;
  /** One of the palette hues, see {@link PALETTE}. */
  hue: Hue;
  /** One of the Material shape names, see {@link SHAPES}. */
  shape: Shape;
  /** How the budget is counted. */
  mode: Mode;
  /** Budget in minutes, per week or per day. */
  budgetMinutes: BudgetMinutes;
  /** Days per week. Used only when `mode` is "day". */
  days: DayCount;
};

export type Block = {
  id: BlockId;
  activityId: ActivityId;
  day: DayIndex;
  start: DayMinute;
  /** `start + length` may pass midnight (an overnight block). */
  length: Length;
};

export type Plan = {
  version: 1;
  activities: Activity[];
  blocks: Block[];
  /** First of the day hours, 0 to 12. */
  dayStart: Hour;
  /** End of the day hours, 13 to 24. */
  dayEnd: Hour;
  /**
   * When the example week was loaded, as an ISO 8601 time in UTC. Null when there is no example
   * week: it was never loaded, or it was kept or replaced.
   */
  exampleLoadedAt: string | null;
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

export type Hue = (typeof PALETTE)[number]["hue"];
export type Shape = (typeof SHAPES)[number];

export function createEmptyPlan(): Plan {
  return {
    version: 1,
    activities: [],
    blocks: [],
    dayStart: sanitizeDayStart(7),
    dayEnd: sanitizeDayEnd(22),
    exampleLoadedAt: null,
  };
}
