import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./prefer-using.ts";

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

new RuleTester().run("prefer-using", rule, {
  valid: [
    "try { load(); } catch { fallBack(); }",
    "{ using stack = new DisposableStack(); stack.defer(close); load(); }",
  ],
  invalid: [
    { code: "try { load(); } finally { close(); }", errors: 1 },
    { code: "try { load(); } catch { fallBack(); } finally { close(); }", errors: 1 },
  ],
});
