import { sanitizeActivityName } from "./activity-name.ts";
import { sanitizeActivityId, sanitizeBlockId, type ActivityId, type BlockId } from "./id.ts";
import {
  sanitizeBudgetMinutes,
  sanitizeDayCount,
  sanitizeDayEnd,
  sanitizeDayIndex as dayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength as length,
} from "./time.ts";
import { type Activity, type Block, type Hue, type Plan, type Shape } from "./types.ts";

// Tests write plain numbers and strings. These turn them into checked values through the same
// sanitizers the app uses, which also keeps the test data valid.
function required<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`The test data has an invalid ${what}.`);
  return value;
}
export const activityId = (id: string): ActivityId =>
  required(sanitizeActivityId(id), "activity id");
export const blockId = (id: string): BlockId => required(sanitizeBlockId(id), "block id");

type ActivityValues = {
  id?: string;
  name?: string;
  hue?: Hue;
  shape?: Shape;
  mode?: Activity["mode"];
  budgetMinutes?: number;
  days?: number;
};
export const activity = ({
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
  id: activityId(id),
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
export const block = (values: BlockValues = {}): Block => ({
  id: blockId(values.id ?? "b"),
  activityId: activityId(values.activityId ?? "a"),
  day: dayIndex(values.day ?? 0),
  start: sanitizeDayMinute(values.start ?? 600),
  length: length(values.length ?? 90),
});

export const hours = (dayStart: number, dayEnd: number): Pick<Plan, "dayStart" | "dayEnd"> => ({
  dayStart: sanitizeDayStart(dayStart),
  dayEnd: sanitizeDayEnd(dayEnd),
});
