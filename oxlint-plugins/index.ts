import { definePlugin } from "@oxlint/plugins";

import noElse from "./no-else.ts";
import requireReason from "./require-reason.ts";

/** The project's own lint rules, named `week-budget-planner/<rule>` in .oxlintrc.json. */
export default definePlugin({
  meta: { name: "week-budget-planner" },
  rules: { "no-else": noElse, "require-reason": requireReason },
});
