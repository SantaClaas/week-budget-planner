import type { Activity } from "../plan/activity/index.ts";
import type { Block } from "../plan/block/index.ts";
import type { Plan } from "../plan/index.ts";
import type { Result } from "../result.ts";

/**
 * The undo steps (see History in docs/spec/interactions.md and Writes and undo in
 * docs/spec/persistence.md). Each step records what one change did, not the whole plan before it:
 * the activities and blocks it added, removed or changed, the activities' order when it moved
 * them, and the plan's own fields it set. Undo
 * applies the step backwards to the plan as it is now, so another tab's changes since stay, and
 * the steps survive them. When something the step touches has changed since, undoing it would
 * overwrite that change, so the step can't be undone at all.
 */

/** How many steps Undo keeps, as in the prototype. */
const LIMIT = 100;

/** An activity or a block: a flat record with an id, whose fields are all plain values. */
type Entity = { id: string };

/**
 * One entity's change. `before` is missing for one the change added and `after` for one it
 * removed. `index` is where it was in its list before, so undoing a removal puts it back there.
 */
type EntityChange<Value extends Entity> = {
  before: Value | undefined;
  after: Value | undefined;
  index: number;
};

/** The plan's own fields a change can set, besides its lists. */
type Fields = Pick<Plan, "dayStart" | "dayEnd" | "exampleLoadedAt">;

const FIELD_NAMES = [
  "dayStart",
  "dayEnd",
  "exampleLoadedAt",
] as const satisfies readonly (keyof Fields)[];

/**
 * The ids of the activities in the list both before and after a change, in each order: what a
 * reorder did. Undefined when the change kept their order.
 */
type Order = { before: string[]; after: string[] } | undefined;

/** What one change did. */
export type Step = {
  activities: EntityChange<Activity>[];
  /** The activities' order, when the change moved some of them. */
  order: Order;
  blocks: EntityChange<Block>[];
  /** The fields the change set: their values before and after. */
  fields: { before: Partial<Fields>; after: Partial<Fields> };
};

/** Whether two records hold the same values, or are both missing. */
function isSameRecord<Value extends Entity>(
  first: Value | undefined,
  second: Value | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  return keys.values().every((key) => Reflect.get(first, key) === Reflect.get(second, key));
}

/** What changed between two versions of a list, entity by entity. */
function compareLists<Value extends Entity>(
  before: readonly Value[],
  after: readonly Value[],
): EntityChange<Value>[] {
  const afterById = new Map(after.map((entity) => [entity.id, entity]));
  const beforeIds = new Set(before.map((entity) => entity.id));
  const changes: EntityChange<Value>[] = [];
  for (const [index, entity] of before.entries()) {
    const changed = afterById.get(entity.id);
    if (!isSameRecord(entity, changed)) changes.push({ before: entity, after: changed, index });
  }
  for (const [index, entity] of after.entries()) {
    if (!beforeIds.has(entity.id)) changes.push({ before: undefined, after: entity, index });
  }
  return changes;
}

/** Whether two lists of ids hold the same ids in the same order. */
const isSameOrder = (first: readonly string[], second: readonly string[]): boolean =>
  first.length === second.length && first.every((id, index) => id === second[index]);

/** The ids of `list` that are also in `other`, in the order of `list`. */
const listSharedIds = (list: readonly Entity[], other: readonly Entity[]): string[] => {
  const otherIds = new Set(other.map((entity) => entity.id));
  return list.map((entity) => entity.id).filter((id) => otherIds.has(id));
};

/** The activities' order before and after, when the change moved some of them. */
function compareOrder(before: readonly Entity[], after: readonly Entity[]): Order {
  const order = { before: listSharedIds(before, after), after: listSharedIds(after, before) };
  return isSameOrder(order.before, order.after) ? undefined : order;
}

/** What the change from `before` to `after` did. */
export function record(before: Plan, after: Plan): Step {
  const fields: Step["fields"] = { before: {}, after: {} };
  for (const name of FIELD_NAMES) {
    if (before[name] === after[name]) continue;
    Object.assign(fields.before, { [name]: before[name] });
    Object.assign(fields.after, { [name]: after[name] });
  }
  return {
    activities: compareLists(before.activities, after.activities),
    order: compareOrder(before.activities, after.activities),
    blocks: compareLists(before.blocks, after.blocks),
    fields,
  };
}

/** Whether a step did nothing, so there's nothing to undo. */
export const isEmpty = (step: Step): boolean =>
  step.activities.length === 0 &&
  step.order === undefined &&
  step.blocks.length === 0 &&
  Object.keys(step.fields.after).length === 0;

/** Whether every entity the changes touched is still as the change left it. */
const isListUnchanged = <Value extends Entity>(
  list: readonly Value[],
  changes: readonly EntityChange<Value>[],
): boolean =>
  changes.every((change) => {
    const id = change.before?.id ?? change.after?.id;
    return isSameRecord(
      list.find((entity) => entity.id === id),
      change.after,
    );
  });

/**
 * The list with the changes undone: what they added goes, what they changed gets its earlier
 * values, and what they removed comes back where it was, or at the end when the list is shorter.
 */
function revertList<Value extends Entity>(
  list: readonly Value[],
  changes: readonly EntityChange<Value>[],
): Value[] {
  const earlier = new Map(
    changes.flatMap((change) =>
      change.after === undefined ? [] : [[change.after.id, change.before] as const],
    ),
  );
  const reverted = list.flatMap((entity) => {
    if (!earlier.has(entity.id)) return [entity];
    const before = earlier.get(entity.id);
    return before === undefined ? [] : [before];
  });
  const removed = changes
    .filter((change) => change.after === undefined)
    .toSorted((first, second) => first.index - second.index);
  for (const change of removed) {
    if (change.before !== undefined) reverted.splice(change.index, 0, change.before);
  }
  return reverted;
}

/** Whether the activities the step reordered are still in the order it left them. */
const isOrderUnchanged = (list: readonly Entity[], order: Order): boolean => {
  if (order === undefined) return true;
  const ids = new Set(order.after);
  return isSameOrder(
    list.map((entity) => entity.id).filter((id) => ids.has(id)),
    order.after,
  );
};

/**
 * The list with the reordered activities back in their earlier order, in the places they hold
 * now, so an activity another tab added since keeps its place.
 */
function revertOrder<Value extends Entity>(list: readonly Value[], order: Order): Value[] {
  if (order === undefined) return [...list];
  const ids = new Set(order.before);
  const byId = new Map(list.map((entity) => [entity.id, entity]));
  const earlier = order.before.flatMap((id) => {
    const entity = byId.get(id);
    return entity === undefined ? [] : [entity];
  });
  let next = 0;
  return list.map((entity) => {
    if (!ids.has(entity.id)) return entity;
    const placed = earlier[next] ?? entity;
    next += 1;
    return placed;
  });
}

/**
 * `plan` with `step` undone. "conflict" when something the step touched has changed since, as
 * another tab can change it, or when undoing it would bring back a block whose activity is gone:
 * then nothing is undone, rather than overwriting the other change or undoing half the step.
 */
export function revert(plan: Plan, step: Step): Result<Plan, "conflict"> {
  const isFieldUnchanged = FIELD_NAMES.every(
    (name) => !(name in step.fields.after) || plan[name] === step.fields.after[name],
  );
  const isUnchanged =
    isFieldUnchanged &&
    isListUnchanged(plan.activities, step.activities) &&
    isOrderUnchanged(plan.activities, step.order) &&
    isListUnchanged(plan.blocks, step.blocks);
  if (!isUnchanged) return "conflict";
  const reverted: Plan = {
    ...plan,
    ...step.fields.before,
    activities: revertOrder(revertList(plan.activities, step.activities), step.order),
    blocks: revertList(plan.blocks, step.blocks),
  };
  const activityIds = new Set(reverted.activities.map((activity) => activity.id));
  const isEveryBlockOwned = reverted.blocks.every((block) => activityIds.has(block.activityId));
  return isEveryBlockOwned ? reverted : "conflict";
}

/** The undo steps with `step` added as the latest, dropping the oldest past the limit. */
export function push(steps: readonly Step[], step: Step): Step[] {
  const kept = steps.length < LIMIT ? steps : steps.slice(steps.length - LIMIT + 1);
  return [...kept, step];
}
