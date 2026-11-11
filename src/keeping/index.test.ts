import { describe, expect, it } from "vitest";

import { createActivity } from "../plan/test-data.ts";
import { isAnswered, isAskDue, markAnswered } from "./index.ts";

/** A localStorage stand-in, and what it holds. */
function createStorage() {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
  return { items, storage };
}

const ownPlan = { activities: [createActivity()], exampleLoadedAt: null };
const due = { plan: ownPlan, level: "full", state: "not-persisted", isAnswered: false } as const;

describe("asking to keep the plan", () => {
  it("asks once the user has a plan of their own that the browser may delete", () => {
    expect(isAskDue(due)).toBe(true);
    expect(isAskDue({ ...due, level: "limited" })).toBe(true);
  });

  it("doesn't ask while the example week is shown, or before there's anything to keep", () => {
    expect(
      isAskDue({ ...due, plan: { ...ownPlan, exampleLoadedAt: "2026-11-11T10:00:00Z" } }),
    ).toBe(false);
    expect(isAskDue({ ...due, plan: { activities: [], exampleLoadedAt: null } })).toBe(false);
  });

  it("doesn't ask when the browser keeps the plan or said no, or the user answered", () => {
    expect(isAskDue({ ...due, state: "persisted" })).toBe(false);
    expect(isAskDue({ ...due, state: "denied" })).toBe(false);
    expect(isAskDue({ ...due, state: undefined })).toBe(false);
    expect(isAskDue({ ...due, isAnswered: true })).toBe(false);
  });

  it("doesn't ask without storage, where there's nothing to keep", () => {
    expect(isAskDue({ ...due, level: "none" })).toBe(false);
  });

  it("remembers the answer", () => {
    const { items, storage } = createStorage();
    expect(isAnswered(storage)).toBe(false);
    markAnswered(Temporal.Instant.from("2026-11-11T10:00:00Z"), storage);
    expect(isAnswered(storage)).toBe(true);
    expect(items.get("week-budget-planner.keep-plan-dismissed-at")).toBe("2026-11-11T10:00:00Z");
  });
});
