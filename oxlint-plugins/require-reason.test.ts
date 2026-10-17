import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./require-reason.ts";

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

const rule = plugin.rules["require-reason"];
if (rule === undefined) throw new Error("The plugin has no require-reason rule.");

new RuleTester().run("require-reason", rule, {
  valid: [
    "// oxlint-disable-next-line no-console -- this line prints on purpose\nconsole.log(1);",
    "/* eslint-disable no-console -- a script that only prints */",
    "// oxlint-disable-line no-console --- extra dashes are fine too",
    "// oxlint-enable no-console",
    "// A comment that mentions oxlint-disable-next-line in passing.",
  ],
  invalid: [
    { code: "// oxlint-disable-next-line no-console\nconsole.log(1);", errors: 1 },
    { code: "// oxlint-disable-next-line no-console -- short\nconsole.log(1);", errors: 1 },
    { code: "/* eslint-disable no-console */", errors: 1 },
    { code: "// oxlint-disable", errors: 1 },
  ],
});
