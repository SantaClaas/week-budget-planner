import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./no-kind.ts";

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

new RuleTester().run("no-kind", rule, {
  valid: [
    // Reading someone else's field, as the TypeScript API's node.kind.
    "if (node.kind === 1) run();",
    "const { kind: part } = node;",
    { code: "type Message = { type: 'result' } | { type: 'error' };", filename: "message.ts" },
    "const half = 'first';",
    // The word in text or a comment says nothing about a name.
    "const text = 'of every kind'; // a kind of row",
  ],
  invalid: [
    { code: "const kind = 1;", errors: 1 },
    { code: "let { kind } = part;", errors: 1 },
    { code: "const [kind] = parts;", errors: 1 },
    { code: "function find(kind) { return kind; }", errors: 1 },
    { code: "const find = (kind = 'a') => kind;", errors: 1 },
    { code: "const find = (kind) => kind;", errors: 1 },
    { code: "const part = { kind: 'first' };", errors: 1 },
    { code: "const part = { kind };", errors: 1 },
    { code: "type Part = { kind: 'only' | 'first' };", errors: 1, filename: "part.ts" },
    { code: "interface Part { kind(): string }", errors: 1, filename: "part.ts" },
    { code: "class Part { kind = 'first'; }", errors: 1 },
    { code: "try { run(); } catch (kind) { report(kind); }", errors: 1 },
  ],
});
