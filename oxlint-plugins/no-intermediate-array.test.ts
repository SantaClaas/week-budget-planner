import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./no-intermediate-array.ts";

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

new RuleTester().run("no-intermediate-array", rule, {
  valid: [
    // One step builds the one array it returns.
    "const ids = rows.map((row) => row.id);",
    "const found = rows.find((row) => row.id === id);",
    // Already lazy.
    "const ids = new Set(rows.values().map((row) => row.id));",
    "const ids = new Set(byId.keys().filter(isKept));",
    "const days = rows.values().filter(isKept).map((row) => row.day).toArray();",
    "const ids = new Set(Iterator.from(rows).map((row) => row.id));",
    "const all = text.matchAll(pattern).map((match) => match[0]).toArray();",
    // An array is needed after one step.
    "const sorted = rows.map((row) => row.id).toSorted();",
    "const text = rows.map((row) => row.name).join(', ');",
    // Not handed to something that takes any iterable.
    "use(rows.map((row) => row.id));",
    "const ids = new Set(rows);",
  ],
  invalid: [
    {
      code: "const ids = new Set(activities.map((row) => row.id));",
      output: "const ids = new Set(activities.values().map((row) => row.id));",
      errors: 1,
    },
    {
      code: "const byId = new Map(plan.blocks.filter(isKept).map((block) => [block.id, block]));",
      output:
        "const byId = new Map(plan.blocks.values().filter(isKept).map((block) => [block.id, block]));",
      errors: 1,
    },
    {
      code: "const byId = Object.fromEntries(rows.map((row) => [row.id, row]));",
      output: "const byId = Object.fromEntries(rows.values().map((row) => [row.id, row]));",
      errors: 1,
    },
    {
      code: "for (const id of rows.map((row) => row.id)) use(id);",
      output: "for (const id of rows.values().map((row) => row.id)) use(id);",
      errors: 1,
    },
    // Two steps in a row: the result is still used as an array.
    {
      code: "const ids = list.map((entity) => entity.id).filter((id) => ids.has(id));",
      output:
        "const ids = list.values().map((entity) => entity.id).filter((id) => ids.has(id)).toArray();",
      errors: 1,
    },
    {
      code: "const sorted = rows.filter(isKept).map((row) => row.id).toSorted();",
      output:
        "const sorted = rows.values().filter(isKept).map((row) => row.id).toArray().toSorted();",
      errors: 1,
    },
    // A step that ends the chain needs no array.
    {
      code: "const isAny = rows.map((row) => row.id).some((id) => id === wanted);",
      output: "const isAny = rows.values().map((row) => row.id).some((id) => id === wanted);",
      errors: 1,
    },
    // Parentheses around the start stay outside.
    {
      code: "const ids = new Set((isOld ? old : rows).map((row) => row.id));",
      output: "const ids = new Set((isOld ? old : rows).values().map((row) => row.id));",
      errors: 1,
    },
  ],
});
