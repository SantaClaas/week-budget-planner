import { describe, expect, it } from "vitest";

import { createActivity, createBlock, createDayHours } from "../plan/test-data.ts";
import { sanitizeDayIndex } from "../plan/time.ts";
import { findOpeningHour, layoutWeek, listHours } from "./layout.ts";

const BRITISH = { locale: "en-GB" };
const work = createActivity({ id: "work", name: "Work" });
const gym = createActivity({ id: "gym", name: "Gym", hue: 152, shape: "arch" });

/** The item at `index`, which the test expects to be there. */
function at<Item>(items: readonly Item[], index: number): Item {
  const item = items[index];
  if (item === undefined) throw new Error(`The test expected an item at ${index.toString()}.`);
  return item;
}

/** The visible time of a block as one string. */
const read = (time: { text: string }[]): string => time.map(({ text }) => text).join("");

describe("the week's layout", () => {
  it("has seven days, Monday first, with the weekend and today marked", () => {
    const days = layoutWeek({ activities: [], blocks: [] }, sanitizeDayIndex(2), BRITISH);
    expect(days.map(({ name }) => name)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days.map(({ isWeekend }) => isWeekend)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(days.filter(({ isToday }) => isToday).map(({ name }) => name)).toEqual(["Wed"]);
    expect(read(at(days, 0).total)).toBe("free");
    expect(at(days, 0).spoken).toBe("Monday, nothing placed");
  });

  it("draws a block with its range, its length and a spoken name", () => {
    const monday = at(
      layoutWeek(
        {
          activities: [gym],
          blocks: [createBlock({ activityId: "gym", start: 1080, length: 90 })],
        },
        undefined,
        BRITISH,
      ),
      0,
    );
    const block = at(monday.blocks, 0);
    expect(read(block.time)).toBe("18:00–19:30 · 1h 30m");
    expect(block.time.filter(({ datetime }) => datetime !== undefined)).toEqual([
      { text: "18:00", datetime: "18:00" },
      { text: "19:30", datetime: "19:30" },
      { text: "1h 30m", datetime: "PT1H30M" },
    ]);
    expect(block.spoken).toBe("Gym, Monday 18:00 to 19:30, 1 hour, 30 minutes");
    expect(block).toMatchObject({ start: 1080, length: 90, size: "regular", nameLines: 3 });
    expect(read(monday.total)).toBe("1h 30m placed");
    expect(monday.spoken).toBe("Monday, 1 hour, 30 minutes placed");
  });

  it("draws an overnight block in two parts, the second named for where it came from", () => {
    const days = layoutWeek(
      {
        activities: [work],
        blocks: [createBlock({ activityId: "work", day: 1, start: 1320, length: 240 })],
      },
      undefined,
      BRITISH,
    );
    const first = at(at(days, 1).blocks, 0);
    const second = at(at(days, 2).blocks, 0);
    expect(first).toMatchObject({ part: "first", start: 1320, length: 120 });
    expect(second).toMatchObject({ part: "second", start: 0, length: 120 });
    expect(read(first.time)).toBe("Tue 22:00 – Wed 02:00 · 4h");
    expect(read(second.time)).toBe("Tue 22:00 – Wed 02:00 · 4h");
    expect(first.spoken).toBe("Work, Tuesday 22:00 to Wednesday 02:00, 4 hours");
    expect(second.spoken).toBe("Work, continued from Tuesday, until 02:00");
  });

  it("puts Sunday night's overflow on Monday morning", () => {
    const monday = at(
      layoutWeek(
        {
          activities: [work],
          blocks: [createBlock({ activityId: "work", day: 6, start: 1380, length: 120 })],
        },
        undefined,
        BRITISH,
      ),
      0,
    );
    expect(monday.blocks.map(({ part, length }) => ({ part, length }))).toEqual([
      { part: "second", length: 60 },
    ]);
  });

  it("gives short blocks one line, and a 15-minute block no room for its shape", () => {
    const monday = at(
      layoutWeek(
        {
          activities: [work],
          blocks: [
            createBlock({ id: "half", activityId: "work", start: 600, length: 30 }),
            createBlock({ id: "quarter", activityId: "work", start: 700, length: 15 }),
          ],
        },
        undefined,
        BRITISH,
      ),
      0,
    );
    expect(monday.blocks.map(({ size, time }) => [size, read(time)])).toEqual([
      ["short", "· 30m"],
      ["tiny", "· 15m"],
    ]);
  });

  it("sets overlapping blocks side by side", () => {
    const monday = at(
      layoutWeek(
        {
          activities: [work],
          blocks: [
            createBlock({ id: "one", activityId: "work", start: 600, length: 90 }),
            createBlock({ id: "two", activityId: "work", start: 630, length: 90 }),
          ],
        },
        undefined,
        BRITISH,
      ),
      0,
    );
    expect(monday.blocks.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("fits as many name lines as the block has room for above the time", () => {
    const lines = [45, 60, 90, 240].map((length) => {
      const days = layoutWeek(
        { activities: [work], blocks: [createBlock({ activityId: "work", length })] },
        undefined,
        BRITISH,
      );
      return at(at(days, 0).blocks, 0).nameLines;
    });
    expect(lines).toEqual([1, 1, 3, 10]);
  });

  it("labels every hour line but midnight", () => {
    const hours = listHours(BRITISH);
    expect(hours).toHaveLength(23);
    expect(hours[0]).toEqual({ hour: 1, text: "01:00", datetime: "01:00" });
    expect(at(hours, 22).text).toBe("23:00");
  });
});

describe("where the week opens", () => {
  it("opens at the day hours' start, or earlier for an earlier block", () => {
    const dayHours = createDayHours(7, 22);
    expect(findOpeningHour({ ...dayHours, blocks: [] })).toBe(7);
    expect(findOpeningHour({ ...dayHours, blocks: [createBlock({ start: 345 })] })).toBe(5);
    expect(findOpeningHour({ ...dayHours, blocks: [createBlock({ start: 600 })] })).toBe(7);
  });

  it("isn't pulled to midnight by an overnight block's second part", () => {
    const dayHours = createDayHours(7, 22);
    const overnight = createBlock({ day: 1, start: 1320, length: 240 });
    expect(findOpeningHour({ ...dayHours, blocks: [overnight] })).toBe(7);
  });
});
