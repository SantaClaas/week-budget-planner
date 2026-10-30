import { definePlugin } from "@oxlint/plugins";

import noElse from "./no-else.ts";
import oneOperationPerTry from "./one-operation-per-try.ts";
import requireReason from "./require-reason.ts";

/** The project's own lint rules, named `week-budget-planner/<rule>` in .oxlintrc.json. */
export default definePlugin({
  meta: { name: "week-budget-planner" },
  rules: {
    "no-else": noElse,
    "one-operation-per-try": oneOperationPerTry,
    "require-reason": requireReason,
  },
});
