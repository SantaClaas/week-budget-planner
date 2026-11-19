import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./blank-line-after-scope.ts";

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

new RuleTester().run("blank-line-after-scope", rule, {
  valid: [
    "function f() {\n  if (a) {\n    b();\n  }\n\n  c();\n}",
    // The scope ends right after: the closing brace follows.
    "function f() {\n  if (a) {\n    b();\n  }\n}",
    "function f() {\n  for (const x of xs) {\n    if (x) return;\n  }\n}",
    "function f() {\n  if (a) return;\n\n  if (b) return;\n\n  c();\n}",
    "function f() {\n  if (a) b();\n  else c();\n\n  d();\n}",
    "switch (a) {\n  case 1:\n    if (b) c();\n\n    break;\n}",
    // Other statements don't open a scope.
    "const a = 1;\nconst b = 2;",
    "function f() {}\nf();",
  ],
  invalid: [
    {
      code: "function f() {\n  if (a) {\n    b();\n  }\n  c();\n}",
      output: "function f() {\n  if (a) {\n    b();\n  }\n\n  c();\n}",
      errors: 1,
    },
    {
      code: "function f() {\n  if (a) return;\n  if (b) return;\n  c();\n}",
      output: "function f() {\n  if (a) return;\n\n  if (b) return;\n\n  c();\n}",
      errors: 2,
    },
    {
      code: "while (a) b();\nc();",
      output: "while (a) b();\n\nc();",
      errors: 1,
    },
    {
      code: "try {\n  a();\n} catch {\n  b();\n}\nc();",
      output: "try {\n  a();\n} catch {\n  b();\n}\n\nc();",
      errors: 1,
    },
    {
      code: "do a();\nwhile (b);\nc();",
      output: "do a();\nwhile (b);\n\nc();",
      errors: 1,
    },
    {
      code: "{\n  using a = b();\n}\nc();",
      output: "{\n  using a = b();\n}\n\nc();",
      errors: 1,
    },
    // A comment on the same line stays on it.
    {
      code: "if (a) return; // why\nb();",
      output: "if (a) return; // why\n\nb();",
      errors: 1,
    },
    // A comment on the next line belongs to the next statement.
    {
      code: "if (a) return;\n// why\nb();",
      output: "if (a) return;\n\n// why\nb();",
      errors: 1,
    },
    {
      code: "switch (a) {\n  case 1:\n    if (b) c();\n    break;\n}",
      output: "switch (a) {\n  case 1:\n    if (b) c();\n\n    break;\n}",
      errors: 1,
    },
  ],
});
