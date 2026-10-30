import { defineRule } from "@oxlint/plugins";

/**
 * A `try` block holds one statement, and not one that branches or loops, so its `catch` handles
 * the failure of one operation and never a programming mistake around it (see "One operation per
 * `try`" in docs/guidelines/principles.md). Where more belongs together, such as a transaction's
 * statements and its commit, the line disables the rule and says why.
 */

/** Statements that are one operation: an expression, a declaration, a return or a throw. */
const SINGLE_OPERATIONS = new Set([
  "ExpressionStatement",
  "VariableDeclaration",
  "ReturnStatement",
  "ThrowStatement",
]);

export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Asks for one operation per `try` block." },
  },
  create(context) {
    return {
      TryStatement(node) {
        const statements = node.block.body;
        const [statement] = statements;
        if (statements.length === 1 && statement && SINGLE_OPERATIONS.has(statement.type)) return;
        context.report({
          node: node.block,
          message:
            "Wrap one operation in try: move the rest after it, reading the result from a let outside, or into a function of its own.",
        });
      },
    };
  },
});
