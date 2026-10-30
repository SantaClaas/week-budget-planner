import type { ActivityId, BlockId } from "../id.ts";
import type { DayIndex, DayMinute, Length } from "../time.ts";

export type Block = {
  id: BlockId;
  activityId: ActivityId;
  day: DayIndex;
  start: DayMinute;
  /** `start + length` may pass midnight (an overnight block). */
  length: Length;
};
