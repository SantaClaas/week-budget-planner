import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./shorter-branch-first.ts";

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

new RuleTester().run("shorter-branch-first", rule, {
  valid: [
    // The shorter branch is inside.
    "function f() {\n  if (ok) {\n    query();\n    return;\n  }\n  a();\n  b();\n}",
    // Equal branches: the ending return doesn't count.
    "function f() {\n  if (x) {\n    a();\n    return;\n  }\n  b();\n}",
    // Comments don't count.
    "function f() {\n  if (x) {\n    // one\n    // two\n    // three\n    return a();\n  }\n  return b();\n}",
    // A guard whose only statement is a long throw.
    "function f() {\n  if (bad) {\n    throw new Error(\n      'a message long enough to wrap'\n    );\n  }\n  a();\n}",
    // Nothing follows, so there's no second branch.
    "function f() {\n  if (x) {\n    a();\n    b();\n    return;\n  }\n}",
    // In a loop, continue ends the branch too.
    "for (const x of xs) {\n  if (x) {\n    a();\n    continue;\n  }\n  b();\n  c();\n}",
  ],
  invalid: [
    {
      code: "function f() {\n  if (late) {\n    a();\n    b();\n    c();\n    return;\n  }\n  query();\n}",
      errors: 1,
    },
    {
      // One statement over several lines counts by its lines.
      code: "function f() {\n  if (x) {\n    post({\n      a,\n      b,\n    });\n    return;\n  }\n  query();\n}",
      errors: 1,
    },
    {
      code: "for (const x of xs) {\n  if (x) {\n    a();\n    b();\n    continue;\n  }\n  c();\n}",
      errors: 1,
    },
  ],
});
