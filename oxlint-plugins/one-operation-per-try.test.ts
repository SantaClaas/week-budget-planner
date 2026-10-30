import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "./one-operation-per-try.ts";

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

new RuleTester().run("one-operation-per-try", rule, {
  valid: [
    "let data; try { data = JSON.parse(text); } catch { data = null; }",
    "async function f() { try { return await load(); } catch { return undefined; } }",
    "try { await write(); } catch (error) { await abort(); throw error; }",
    "try { throw new Error('x'); } catch {}",
  ],
  invalid: [
    { code: "try { const data = JSON.parse(text); use(data); } catch {}", errors: 1 },
    { code: "try { if (x) a(); } catch {}", errors: 1 },
    { code: "try { for (const x of xs) a(x); } catch {}", errors: 1 },
    { code: "try {} finally { done(); }", errors: 1 },
  ],
});
