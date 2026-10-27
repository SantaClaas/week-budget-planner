import { defineRule } from "@oxlint/plugins";

/**
 * Every `else` is reported: handle the special case first and return early, or give a branch a
 * function of its own (see "Return early instead of `else`" in docs/guidelines/principles.md).
 * Where an `else` really is the clearest way, the line disables the rule and says why.
 */
export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Asks for an early return instead of `else`." },
  },
  create(context) {
    return {
      IfStatement(node) {
        // `else if` is an `if` in the alternate, so each `else` is reported once.
        if (node.alternate === null) return;
        context.report({
          node: node.alternate,
          message:
            "Return early instead of else: handle this case first and return, or move a branch into a function of its own.",
        });
      },
    };
  },
});
