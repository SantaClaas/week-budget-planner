import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./no-else.ts";

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

new RuleTester().run("no-else", rule, {
  valid: [
    "function f(x) { if (x) return 1; return 2; }",
    "for (const x of []) { if (x) continue; console.log(x); }",
    "const mode = x === 'day' ? 'day' : 'week';",
  ],
  invalid: [
    { code: "if (x) { a(); } else { b(); }", errors: 1 },
    { code: "if (x) { a(); } else if (y) { b(); }", errors: 1 },
    { code: "if (x) { a(); } else if (y) { b(); } else { c(); }", errors: 2 },
  ],
});
