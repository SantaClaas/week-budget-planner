// The plan's list of activities: adding, changing and removing one. Each function gives back a new
// plan and leaves the one it was given as it was (see "A pure core" in docs/guidelines/principles.md).
import type { ActivityId } from "../id.ts";
import type { Plan } from "../index.ts";
import type { Activity } from "./index.ts";

/** The plan with `activity` at the end of its list. */
export const add = (plan: Plan, activity: Activity): Plan => ({
  ...plan,
  activities: [...plan.activities, activity],
});

/**
 * The plan with the activity `id` changed to `changes`, in the same place in the list. The same
 * plan when there's no such activity, or nothing changed, so the planner records no undo step.
 */
export function update(plan: Plan, id: ActivityId, changes: Omit<Activity, "id">): Plan {
  const before = plan.activities.find((activity) => activity.id === id);
  if (before === undefined) return plan;
  const isUnchanged =
    changes.name === before.name &&
    changes.hue === before.hue &&
    changes.shape === before.shape &&
    changes.mode === before.mode &&
    changes.budgetMinutes === before.budgetMinutes &&
    changes.days === before.days;
  if (isUnchanged) return plan;
  const after: Activity = { ...changes, id };
  return {
    ...plan,
    activities: plan.activities.map((activity) => (activity.id === id ? after : activity)),
  };
}

/**
 * The plan without the activity `id` and its blocks, and how many blocks went with it, for the
 * snackbar ("Deleted Gym and its 3 blocks."). The same plan when there's no such activity.
 */
export function remove(plan: Plan, id: ActivityId): { plan: Plan; removedBlocks: number } {
  if (!plan.activities.some((activity) => activity.id === id)) return { plan, removedBlocks: 0 };
  const blocks = plan.blocks.filter((block) => block.activityId !== id);
  return {
    plan: {
      ...plan,
      activities: plan.activities.filter((activity) => activity.id !== id),
      blocks,
    },
    removedBlocks: plan.blocks.length - blocks.length,
  };
}
