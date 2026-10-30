import type { Activity } from "./activity/index.ts";
import type { Block } from "./block/index.ts";
import { sanitizeDayEnd, sanitizeDayStart, type Hour } from "./time.ts";

/** The one reusable week: its activities, their blocks and the day hours (see docs/spec/glossary.md). */
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
