import { describe, expect, it } from "vitest";

import { createActivity, createBlock, createDayHours } from "../plan/test-data.ts";
import { sanitizeDayIndex, sanitizeDayMinute } from "../plan/time.ts";
import { describeAdded, describeSlot, describeStart, listChoices } from "./index.ts";

const format = { locale: "en-GB" };
const lecture = createActivity({ id: "lecture", name: "Lecture", budgetMinutes: 180 });
const gym = createActivity({ id: "gym", name: "Gym", mode: "day", budgetMinutes: 90, days: 3 });
const work = createActivity({ id: "work", name: "Work", budgetMinutes: 240 });
const study = createActivity({ id: "study", name: "Study", budgetMinutes: 60 });
const plan = {
  activities: [lecture, gym, work, study],
  blocks: [
    createBlock({ id: "1", activityId: "lecture", length: 180 }),
    createBlock({ id: "2", activityId: "work", length: 60 }),
    createBlock({ id: "3", activityId: "study", length: 90 }),
  ],
  ...createDayHours(7, 22),
};
const slot = { day: sanitizeDayIndex(4), start: sanitizeDayMinute(840) };

describe("the Add block chooser", () => {
  it("lists those with the most left first, and those all placed or over budget last", () => {
    expect(listChoices(plan, slot, format).map((choice) => choice.activity.name)).toEqual([
      "Gym",
      "Work",
      "Lecture",
      "Study",
    ]);
  });

  it("says what's left, and that a block would go over budget", () => {
    const [gymChoice, workChoice, lectureChoice, studyChoice] = listChoices(plan, slot, format);
    expect(gymChoice).toMatchObject({
      isWithinBudget: true,
      description: "4 hrs, 30 mins left · usually 1 hr, 30 mins",
    });
    expect(workChoice?.description).toBe("3 hrs left");
    expect(lectureChoice).toMatchObject({
      isWithinBudget: false,
      description: "All placed · this would go over budget",
    });
    expect(studyChoice?.description).toBe("30 mins over budget");
  });

  it("gives each the default length, ended by the day hours", () => {
    expect(listChoices(plan, slot, format).map((choice) => choice.length)).toEqual([
      90, 90, 90, 90,
    ]);
    const late = { day: sanitizeDayIndex(4), start: sanitizeDayMinute(1260) };
    expect(listChoices(plan, late, format)[0]?.length).toBe(60);
  });

  it("names the slot and the added block", () => {
    expect(describeSlot(slot, format)).toBe("Friday 14:00");
    expect(describeStart(slot, format)).toBe("Friday · from 14:00");
    const block = createBlock({ day: 1, start: 600, length: 90 });
    expect(describeAdded(gym, block, format)).toBe("Added Gym · Tue 10:00–11:30");
  });
});
