import { describe, expect, it } from "vitest";

import { createBlock } from "../plan/test-data.ts";
import { sanitizeDayIndex } from "../plan/time.ts";
import { splitIntoParts } from "../plan/week.ts";
import { drag, measureGrab, readMinute } from "./drag.ts";

const at = (day: number, minute: number) => ({ day: sanitizeDayIndex(day), minute });
const lecture = createBlock({ day: 0, start: 600, length: 90 });
const [onlyPart] = splitIntoParts(lecture);
const shift = createBlock({ day: 1, start: 1320, length: 240 });
const [firstPart, secondPart] = splitIntoParts(shift);

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("The test block has no such part.");
  return value;
}

describe("dragging a block", () => {
  it("reads the minute from the height in a day column", () => {
    expect(readMinute(0, 1152)).toBe(0);
    expect(readMinute(576, 1152)).toBe(720);
    expect(readMinute(-20, 1152)).toBe(0);
    expect(readMinute(2000, 1152)).toBe(1440);
  });

  it("moves by the body, keeping where it was held and its length", () => {
    const part = required(onlyPart);
    // Held 30 minutes in, let go at Wednesday 14:40: the top edge lands on 14:15 (snapped).
    const grab = measureGrab(part, 630);
    expect(grab).toBe(30);
    expect(drag(part, "body", grab, at(2, 880))).toMatchObject({ day: 2, start: 855, length: 90 });
  });

  it("runs past midnight when moved late, and never starts after 23:45", () => {
    const part = required(onlyPart);
    expect(drag(part, "body", 0, at(4, 1380))).toMatchObject({ day: 4, start: 1380, length: 90 });
    expect(drag(part, "body", 0, at(4, 1440))).toMatchObject({ day: 4, start: 1425 });
    expect(drag(part, "body", 60, at(6, 30))).toMatchObject({ day: 6, start: 0 });
  });

  it("moves an overnight block by its second part, with the start from the day before", () => {
    const part = required(secondPart);
    // Held at Wednesday 01:00, an hour into the second part: 3 hours from the start.
    const grab = measureGrab(part, 60);
    expect(grab).toBe(180);
    // Let go at Thursday 02:00: the block starts Wednesday 23:00.
    expect(drag(part, "body", grab, at(3, 120))).toMatchObject({ day: 2, start: 1380 });
    // On Monday morning, the block starts on Sunday: the week wraps.
    expect(drag(part, "body", grab, at(0, 120))).toMatchObject({ day: 6, start: 1380 });
  });

  it("resizes from the top, keeping the end", () => {
    expect(drag(required(onlyPart), "top", 0, at(0, 545))).toMatchObject({
      start: 540,
      length: 150,
    });
    // The first part's top edge of an overnight block moves its start the same way.
    expect(drag(required(firstPart), "top", 0, at(1, 1200))).toMatchObject({
      start: 1200,
      length: 360,
    });
  });

  it("resizes from the bottom within the part's own day", () => {
    expect(drag(required(onlyPart), "bottom", 0, at(0, 720))).toMatchObject({ length: 120 });
    // A one-day block ends by midnight at the latest.
    expect(drag(required(onlyPart), "bottom", 0, at(1, 1440))).toMatchObject({ length: 840 });
    // An overnight block's second part moves the end on the next day.
    expect(drag(required(secondPart), "bottom", 0, at(2, 180))).toMatchObject({ length: 300 });
  });
});
