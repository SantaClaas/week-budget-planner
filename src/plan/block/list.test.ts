import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../index.ts";
import { createActivity, createBlock, createBlockId, createDayHours } from "../test-data.ts";
import { sanitizeDayIndex, sanitizeDayMinute } from "../time.ts";
import { changeLength, moveTo } from "../week.ts";
import * as list from "./list.ts";

/** A slot, from plain numbers. */
const at = (day: number, start: number) => ({
  day: sanitizeDayIndex(day),
  start: sanitizeDayMinute(start),
});

const lecture = createBlock({ id: "lecture", day: 0, start: 600, length: 90 });
const shift = createBlock({ id: "shift", day: 1, start: 1320, length: 240 });
const plan: Plan = {
  ...createEmptyPlan(),
  activities: [createActivity()],
  blocks: [lecture, shift],
};

describe("block list", () => {
  it("puts a changed block in its place", () => {
    const moved = moveTo(lecture, 2, 660);
    const changed = list.update(plan, moved);
    expect(changed.blocks).toEqual([moved, shift]);
    expect(plan.blocks).toEqual([lecture, shift]);
  });

  it("gives back the same plan when nothing changes", () => {
    expect(list.update(plan, { ...lecture })).toBe(plan);
    expect(list.update(plan, { ...lecture, id: createBlockId("gone") })).toBe(plan);
  });

  it("compares every field of a block", () => {
    // update() compares these by name. If Block gains a field, add it there, then here.
    expect(Object.keys(lecture).toSorted()).toEqual(
      ["activityId", "day", "id", "length", "start"].toSorted(),
    );
    for (const changed of [
      createBlock({ id: "lecture", activityId: "other", day: 0, start: 600, length: 90 }),
      moveTo(lecture, 1, 600),
      moveTo(lecture, 0, 615),
      changeLength(lecture, 15),
    ]) {
      expect(list.update(plan, changed)).not.toBe(plan);
    }
  });

  it("removes a block", () => {
    expect(list.remove(plan, lecture.id).blocks).toEqual([shift]);
    expect(list.remove(plan, createBlockId("gone"))).toBe(plan);
  });
  it("creates a block with the default length at a slot, and adds it", () => {
    const gym = createActivity({ id: "gym", mode: "day", budgetMinutes: 90, days: 3 });
    const id = createBlockId("new");
    const empty = { ...plan, activities: [gym], blocks: [], ...createDayHours(7, 22) };
    // Per day, the default length is the budget per day.
    const block = list.create(empty, gym, at(2, 1080), id);
    expect(block).toMatchObject({ id: "new", activityId: "gym", day: 2, start: 1080, length: 90 });
    expect(list.add(empty, block).blocks).toEqual([block]);
    // Inside the day hours it ends by their end; outside them it keeps its length.
    expect(list.create(empty, gym, at(2, 1290), id).length).toBe(30);
    expect(list.create(empty, gym, at(2, 1380), id).length).toBe(90);
  });
});
