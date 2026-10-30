import { sanitizeActivityName } from "./activity-name.ts";
import {
  sanitizeActivityId,
  sanitizeBlockId,
  type ActivityId,
  type BlockId,
  type IdGenerator,
} from "./id.ts";
import {
  sanitizeBudgetMinutes,
  sanitizeDayCount,
  sanitizeDayEnd,
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength,
} from "./time.ts";
import { type Activity, type Block, type Hue, type Plan, type Shape } from "./types.ts";

// Tests write plain numbers and strings. These turn them into checked values through the same
// sanitizers the app uses, which also keeps the test data valid.
function required<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`The test data has an invalid ${what}.`);
  return value;
}
export const createActivityId = (id: string): ActivityId =>
  required(sanitizeActivityId(id), "activity id");
export const createBlockId = (id: string): BlockId => required(sanitizeBlockId(id), "block id");

/** New ids a test can predict: "new-activity-1", "new-block-1", "new-activity-2" and so on. */
export function createPredictableIds(): IdGenerator {
  let count = 0;
  return {
    createActivityId: () => createActivityId(`new-activity-${String((count += 1))}`),
    createBlockId: () => createBlockId(`new-block-${String((count += 1))}`),
  };
}

type ActivityValues = {
  id?: string;
  name?: string;
  hue?: Hue;
  shape?: Shape;
  mode?: Activity["mode"];
  budgetMinutes?: number;
  days?: number;
};
export const createActivity = ({
  id = "a",
  mode = "week",
  budgetMinutes = 720,
  days = 5,
  name = "Work",
  ...rest
}: ActivityValues = {}): Activity => ({
  hue: 78,
  shape: "square",
  ...rest,
  id: createActivityId(id),
  name: sanitizeActivityName(name),
  mode,
  budgetMinutes: sanitizeBudgetMinutes(budgetMinutes, mode),
  days: sanitizeDayCount(days),
});

type BlockValues = {
  id?: string;
  activityId?: string;
  day?: number;
  start?: number;
  length?: number;
};
export const createBlock = (values: BlockValues = {}): Block => ({
  id: createBlockId(values.id ?? "b"),
  activityId: createActivityId(values.activityId ?? "a"),
  day: sanitizeDayIndex(values.day ?? 0),
  start: sanitizeDayMinute(values.start ?? 600),
  length: sanitizeLength(values.length ?? 90),
});

export const createDayHours = (
  dayStart: number,
  dayEnd: number,
): Pick<Plan, "dayStart" | "dayEnd"> => ({
  dayStart: sanitizeDayStart(dayStart),
  dayEnd: sanitizeDayEnd(dayEnd),
});
