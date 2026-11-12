import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createActivity, createBlock, createDayHours } from "../plan/test-data.ts";
import { isEmpty, push, record, revert, type Step } from "./undo.ts";

const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", mode: "day", budgetMinutes: 90, days: 3 });
const lecture = createActivity({ id: "lecture", name: "Lecture" });
const morning = createBlock({ id: "morning", activityId: "work", start: 480 });
const evening = createBlock({ id: "evening", activityId: "gym", start: 1080 });

/** A plan with Work, Gym and Lecture, a Work block in the morning and a Gym block in the evening. */
const createPlan = (changes: Partial<Plan> = {}): Plan => ({
  ...createEmptyPlan(),
  activities: [work, gym, lecture],
  blocks: [morning, evening],
  ...changes,
});

/** Records the change `update` makes to `before`, and gives back the plan after it too. */
function change(before: Plan, update: (plan: Plan) => Plan): { after: Plan; step: Step } {
  const after = update(before);
  return { after, step: record(before, after) };
}

describe("an undo step", () => {
  it("undoes a move back to where the block was", () => {
    const before = createPlan();
    const moved = createBlock({ id: "morning", activityId: "work", start: 540 });
    const { after, step } = change(before, (plan) => ({ ...plan, blocks: [moved, evening] }));
    expect(revert(after, step)).toEqual(before);
  });

  it("brings a deleted activity and its blocks back where they were", () => {
    const before = createPlan();
    const { after, step } = change(before, (plan) => ({
      ...plan,
      activities: [work, lecture],
      blocks: [morning],
    }));
    expect(revert(after, step)).toEqual(before);
  });

  it("removes what the change added", () => {
    const before = createPlan();
    const added = createBlock({ id: "added", activityId: "lecture" });
    const { after, step } = change(before, (plan) => ({
      ...plan,
      blocks: [...plan.blocks, added],
    }));
    expect(revert(after, step)).toEqual(before);
  });

  it("sets the plan's own fields back", () => {
    const before = createPlan({ exampleLoadedAt: "2026-11-01T10:00:00Z" });
    const { after, step } = change(before, (plan) => ({
      ...plan,
      ...createDayHours(8, 20),
      exampleLoadedAt: null,
    }));
    expect(revert(after, step)).toEqual(before);
  });

  it("keeps what another tab changed since, when it's something else", () => {
    const before = createPlan();
    const moved = createBlock({ id: "morning", activityId: "work", start: 540 });
    const { after, step } = change(before, (plan) => ({ ...plan, blocks: [moved, evening] }));
    // Another tab renames Lecture and sets the day hours.
    const renamed = createActivity({ id: "lecture", name: "Statistics" });
    const elsewhere: Plan = {
      ...after,
      ...createDayHours(6, 23),
      activities: [work, gym, renamed],
    };
    expect(revert(elsewhere, step)).toEqual({
      ...elsewhere,
      blocks: [morning, evening],
    });
  });

  it("can't be undone once another tab changed what it touched, so nothing changes", () => {
    const before = createPlan();
    const moved = createBlock({ id: "morning", activityId: "work", start: 540 });
    const { after, step } = change(before, (plan) => ({ ...plan, blocks: [moved, evening] }));
    // Another tab moves the same block again, or deletes it.
    const movedAgain = createBlock({ id: "morning", activityId: "work", start: 600 });
    expect(revert({ ...after, blocks: [movedAgain, evening] }, step)).toBe("conflict");
    expect(revert({ ...after, blocks: [evening] }, step)).toBe("conflict");
  });

  it("can't bring back a block whose activity another tab deleted", () => {
    const before = createPlan();
    const { after, step } = change(before, (plan) => ({ ...plan, blocks: [evening] }));
    // Another tab deletes Work, which the removed block belongs to.
    expect(revert({ ...after, activities: [gym, lecture] }, step)).toBe("conflict");
  });

  it("can't set a field back that another tab changed since", () => {
    const before = createPlan();
    const { after, step } = change(before, (plan) => ({ ...plan, ...createDayHours(8, 22) }));
    expect(revert({ ...after, ...createDayHours(9, 22) }, step)).toBe("conflict");
  });

  it("puts reordered activities back in their earlier order", () => {
    const before = createPlan();
    const { after, step } = change(before, (plan) => ({
      ...plan,
      activities: [lecture, work, gym],
    }));
    expect(revert(after, step)).toEqual(before);
    // Deleting an activity keeps the others' order, so it records no reorder.
    expect(record(before, { ...before, activities: [work, lecture] }).order).toBeUndefined();
  });

  it("keeps an activity another tab added since in its place, when undoing a reorder", () => {
    const before = createPlan();
    const { after, step } = change(before, (plan) => ({
      ...plan,
      activities: [lecture, work, gym],
    }));
    const added = createActivity({ id: "added", name: "Added" });
    const elsewhere: Plan = { ...after, activities: [lecture, added, work, gym] };
    expect(revert(elsewhere, step)).toEqual({
      ...elsewhere,
      activities: [work, added, gym, lecture],
    });
  });

  it("can't undo a reorder once another tab reordered the same activities", () => {
    const before = createPlan();
    const { after, step } = change(before, (plan) => ({
      ...plan,
      activities: [lecture, work, gym],
    }));
    expect(revert({ ...after, activities: [work, lecture, gym] }, step)).toBe("conflict");
  });

  it("is empty when nothing changed", () => {
    const plan = createPlan();
    expect(isEmpty(record(plan, { ...plan }))).toBe(true);
    expect(isEmpty(record(plan, { ...plan, blocks: [evening] }))).toBe(false);
  });
});

/** A step that sets the day's start to `hour`, to tell steps apart. */
const createStep = (hour: number): Step =>
  record(createPlan(), createPlan(createDayHours(hour % 12, 22)));

describe("the undo steps", () => {
  it("keep the latest step last", () => {
    const first = createStep(1);
    const second = createStep(2);
    expect(push(push([], first), second)).toEqual([first, second]);
  });

  it("keep the latest 100 and drop the oldest", () => {
    const created = Array.from({ length: 101 }, (_, index) => createStep(index));
    const steps = created.reduce<readonly Step[]>((kept, step) => push(kept, step), []);
    expect(steps).toHaveLength(100);
    expect(steps[0]).toBe(created[1]);
    expect(steps.at(-1)).toBe(created[100]);
  });
});
