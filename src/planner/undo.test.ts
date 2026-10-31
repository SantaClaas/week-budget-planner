import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { push } from "./undo.ts";

describe("the undo steps", () => {
  it("keep the latest step last", () => {
    const first = createEmptyPlan();
    const second = createEmptyPlan();
    expect(push(push([], first), second)).toEqual([first, second]);
    expect(push(push([], first), second).at(-1)).toBe(second);
  });

  it("keep the latest 100 and drop the oldest", () => {
    const plans = Array.from({ length: 101 }, () => createEmptyPlan());
    const steps = plans.reduce<readonly Plan[]>((kept, plan) => push(kept, plan), []);
    expect(steps).toHaveLength(100);
    expect(steps[0]).toBe(plans[1]);
    expect(steps.at(-1)).toBe(plans[100]);
  });
});
