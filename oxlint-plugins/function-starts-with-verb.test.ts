import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import rule from "./function-starts-with-verb.ts";
import verbs from "./verbs.json" with { type: "json" };

// RuleTester names and runs its own tests, and makes the assertions in them. Handing it Vitest's
// describe and it lets Vitest report them.
RuleTester.describe = (text, run) => {
  // oxlint-disable-next-line vitest/valid-title, vitest/valid-describe-callback -- RuleTester passes its own title and callback through.
  describe(text, run);
};
RuleTester.it = (text, run) => {
  // oxlint-disable-next-line vitest/valid-title, vitest/expect-expect -- RuleTester passes its own title through and asserts inside run.
  it(text, run);
};

new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } }).run(
  "function-starts-with-verb",
  rule,
  {
    valid: [
      // Verbs, alone or followed by a noun.
      "function openStorage() {}",
      "function open() {}",
      "const moveBlock = (block) => block;",
      "const save = function () {};",
      "const read2 = () => 2;",
      // Predicates and event handlers.
      "const isFree = (slot) => true;",
      "function hasBlocks(plan) { return true; }",
      "const canUndo = (history) => true;",
      "const onMove = (event) => event;",
      // Components and classes start with a capital.
      "function Week() { return null; }",
      "const ActivityRow = (properties) => null;",
      "class Store { load() {} }",
      // Solid's derived values: no parameters, inside a component.
      "function Week(properties) { const days = () => properties.plan.days; return days; }",
      "type Properties = { plan: () => Plan };",
      "interface Planner { plan(): Plan }",
      // Not functions, or not a const.
      "const summary = summarize(plan);",
      "let current = () => 1;",
      // An object literal's keys come from the type it fills.
      "const plugin = { configResolved(config) {}, tone: (scheme) => 40 };",
      // Getters, setters and computed names.
      "class Plan { get length() { return 0; } set length(value) {} [Symbol.dispose]() {} }",
      // Names that don't start with a lowercase letter.
      "function _private() {}",
      "const $ = (selector) => selector;",
    ],
    invalid: [
      { code: "function between(start, end) {}", errors: 1 },
      { code: "const integer = (random) => 1;", errors: 1 },
      { code: "const next = function (clock) {};", errors: 1 },
      // A test helper at the top level, even without parameters.
      { code: "const example = () => createExampleWeek();", errors: 1 },
      { code: "function at(day, start) { return { day, start }; }", errors: 1 },
      // A nested function with parameters isn't an accessor.
      { code: "function build() { const named = (name) => name; return named; }", errors: 1 },
      { code: "class Clock { next(after) {} }", errors: 1 },
      { code: "interface Files { exists(path: string): boolean }", errors: 1 },
      { code: "type Files = { exists: (path: string) => boolean };", errors: 1 },
      // The word stops at the first capital, digit or underscore.
      { code: "const toBytes = (text) => text;", errors: 1 },
      { code: "const level2 = (x) => x;", errors: 1 },
    ],
  },
);

describe("the list of verbs", () => {
  it("holds lowercase words only", () => {
    expect(verbs.filter((verb) => !/^[a-z]+$/u.test(verb))).toEqual([]);
  });

  it("is sorted, with each verb once", () => {
    expect(verbs).toEqual([...new Set(verbs)].toSorted());
  });
});
