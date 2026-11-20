import exampleWeek from "../../examples/example-week.json";
import type { ActivityId, IdGenerator } from "./id.ts";
import { sanitizePlan } from "./sanitize.ts";
import { createEmptyPlan, type Plan } from "./index.ts";

/**
 * The example week from examples/example-week.json, marked as loaded at `now`, with new ids for
 * every activity and block. A row's identity comes from one act of creating it, so two devices'
 * example weeks never merge into one as if they were one plan edited twice (see The example week
 * in docs/spec/merge.md).
 */
export function createExampleWeek(now: Temporal.Instant, ids: IdGenerator): Plan {
  const example = sanitizePlan(exampleWeek, ids);
  const newIds = new Map<ActivityId, ActivityId>();
  const activities = example.activities.map((activity) => {
    const id = ids.createActivityId();
    newIds.set(activity.id, id);
    return { ...activity, id };
  });
  // sanitizePlan has dropped every block whose activity isn't there, so each one finds its new id.
  const blocks = example.blocks.flatMap((block) => {
    const activityId = newIds.get(block.activityId);
    return activityId === undefined ? [] : [{ ...block, id: ids.createBlockId(), activityId }];
  });
  return { ...example, activities, blocks, exampleLoadedAt: now.toString() };
}

/** "Keep these": the plan as it is, no longer marked as the example week. */
export const keepExampleWeek = (plan: Plan): Plan =>
  plan.exampleLoadedAt === null ? plan : { ...plan, exampleLoadedAt: null };

/** "Start empty": no activities and no blocks. The day hours stay as they were. */
export const startEmpty = (plan: Plan): Plan => ({
  ...createEmptyPlan(),
  dayStart: plan.dayStart,
  dayEnd: plan.dayEnd,
});
