import type { ActivityId } from "../id.ts";
import type { BudgetMinutes, DayCount } from "../time.ts";
import type { Hue, Shape } from "./look.ts";
import type { ActivityName } from "./name.ts";

export type Mode = "week" | "day";

export type Activity = {
  id: ActivityId;
  name: ActivityName;
  /** One of the palette hues (see `PALETTE` in ./look.ts). */
  hue: Hue;
  /** One of the Material shape names (see `SHAPES` in ./look.ts). */
  shape: Shape;
  /** How the budget is counted. */
  mode: Mode;
  /** Budget in minutes, per week or per day. */
  budgetMinutes: BudgetMinutes;
  /** Days per week. Used only when `mode` is "day". */
  days: DayCount;
};
