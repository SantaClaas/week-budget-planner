// Replaying an action on a plan that changed since: a tab saves the plan it showed before an action
// and the plan after, and the stored plan may hold another tab's or device's change by then. Only
// what the action changed is applied, field by field, so the other change stays (see Storage in
// docs/spec/merge.md). The action itself can't be sent, since a tab's saves reach the database
// through the leader tab, and a function doesn't cross between tabs.
import type { Activity } from "../plan/activity/index.ts";
import type { Block } from "../plan/block/index.ts";
import type { ActivityId } from "../plan/id.ts";
import type { Plan } from "../plan/index.ts";

/** The plan's own fields an action can set, besides its lists. */
const FIELDS = ["dayStart", "dayEnd", "exampleLoadedAt"] as const;

/**
 * Whether two versions of an activity differ in their budget, which changes as one: the limit of
 * the minutes depends on the mode.
 */
const isBudgetChanged = (first: Activity, second: Activity): boolean =>
  first.mode !== second.mode ||
  first.budgetMinutes !== second.budgetMinutes ||
  first.days !== second.days;

/**
 * The activity as it is now, with what the action changed in it.
 *
 * @param now - The activity in the plan the action is replayed on.
 * @param before - It in the plan the action started from.
 * @param after - It in the plan the action made.
 */
function replayActivity(now: Activity, before: Activity, after: Activity): Activity {
  return {
    ...now,
    name: before.name === after.name ? now.name : after.name,
    hue: before.hue === after.hue ? now.hue : after.hue,
    shape: before.shape === after.shape ? now.shape : after.shape,
    ...(isBudgetChanged(before, after)
      ? { mode: after.mode, budgetMinutes: after.budgetMinutes, days: after.days }
      : {}),
  };
}

/** The block as it is now, with its time as the action left it if the action changed it. */
const replayBlock = (now: Block, before: Block, after: Block): Block =>
  before.day === after.day && before.start === after.start && before.length === after.length
    ? now
    : { ...now, day: after.day, start: after.start, length: after.length };

/** Whether two lists of ids hold the same ids in the same order. */
const isSameOrder = (first: readonly ActivityId[], second: readonly ActivityId[]): boolean =>
  first.length === second.length && first.every((id, index) => id === second[index]);

/**
 * The activities in the order the action gave them, where it reordered them, in the places they
 * hold now, so an activity added elsewhere keeps its place. New activities go after the activity
 * the action put them after, or first.
 *
 * @param activities - The activities now, with the action's changes, in their order now, without
 *   the ones the action added.
 * @param before - The activities the action started from.
 * @param after - The activities the action made, in its order.
 * @param added - The ids of the activities the action added.
 */
function replayOrder(
  activities: readonly Activity[],
  before: readonly Activity[],
  after: readonly Activity[],
  added: ReadonlySet<ActivityId>,
): Activity[] {
  const present = new Set(activities.values().map((activity) => activity.id));
  const beforeIds = new Set(before.values().map((activity) => activity.id));
  const isShared = (id: ActivityId): boolean => present.has(id) && beforeIds.has(id);
  const orderBefore = before
    .values()
    .map((activity) => activity.id)
    .filter((id) => isShared(id) && !added.has(id))
    .toArray();
  const orderAfter = after
    .values()
    .map((activity) => activity.id)
    .filter((id) => isShared(id) && !added.has(id))
    .toArray();
  const byId = new Map(activities.values().map((activity) => [activity.id, activity]));
  const shared = new Set(orderAfter);
  let next = 0;
  const reordered = isSameOrder(orderBefore, orderAfter)
    ? [...activities]
    : activities
        .values()
        .map((activity) => {
          if (!shared.has(activity.id)) return activity;

          const placed = byId.get(orderAfter[next] ?? activity.id) ?? activity;
          next += 1;
          return placed;
        })
        .toArray();

  for (const [index, activity] of after.entries()) {
    if (!added.has(activity.id)) continue;

    const previous = after
      .slice(0, index)
      .findLast((each) => reordered.some((placed) => placed.id === each.id));
    const at =
      previous === undefined ? 0 : reordered.findIndex((placed) => placed.id === previous.id) + 1;
    reordered.splice(at, 0, activity);
  }

  return reordered;
}

/**
 * The plan now with what an action changed applied to it, field by field: a field the action
 * didn't change keeps its value now, a row it removed goes, and a row it added comes. A change made
 * since to the same field gives way to the action's; a row deleted since stays deleted, as a delete
 * wins (see Deleting in docs/spec/merge.md).
 *
 * @param now - The plan the action is replayed on: the one the rows show.
 * @param before - The plan the action started from.
 * @param after - The plan the action made from `before`.
 * @returns The plan after the action, as if it had been made on `now`. It's `after` itself where
 *   `now` is `before`.
 */
export function replay(now: Plan, before: Plan, after: Plan): Plan {
  if (now === before) return after;

  const activitiesBefore = new Map(before.activities.values().map((each) => [each.id, each]));
  const activitiesAfter = new Map(after.activities.values().map((each) => [each.id, each]));
  const added = new Set(
    after.activities
      .values()
      .filter((activity) => !activitiesBefore.has(activity.id))
      .map((activity) => activity.id),
  );
  // An activity the action added comes as the action left it, also where it's there now.
  const kept = now.activities.flatMap((activity) => {
    const was = activitiesBefore.get(activity.id);
    const is = activitiesAfter.get(activity.id);
    if (added.has(activity.id)) return [];

    if (was === undefined) return [activity];

    return is === undefined ? [] : [replayActivity(activity, was, is)];
  });
  const activities = replayOrder(kept, before.activities, after.activities, added);

  const living = new Set(activities.values().map((activity) => activity.id));
  const blocksBefore = new Map(before.blocks.values().map((each) => [each.id, each]));
  const blocksAfter = new Map(after.blocks.values().map((each) => [each.id, each]));
  const keptBlocks = now.blocks.flatMap((block) => {
    const was = blocksBefore.get(block.id);
    const is = blocksAfter.get(block.id);
    if (was === undefined) return is === undefined ? [block] : [];

    return is === undefined ? [] : [replayBlock(block, was, is)];
  });
  const addedBlocks = after.blocks.filter((block) => !blocksBefore.has(block.id));
  const blocks = [...keptBlocks, ...addedBlocks].filter((block) => living.has(block.activityId));

  const fields = Object.fromEntries(
    FIELDS.values().map((name) => [name, before[name] === after[name] ? now[name] : after[name]]),
  );
  return { ...now, ...fields, activities, blocks };
}
