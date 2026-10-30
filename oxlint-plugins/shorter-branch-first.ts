import { defineRule } from "@oxlint/plugins";

/**
 * When a function or loop ends in two branches (an `if` whose block ends the scope, and the
 * statements after it), the shorter one goes inside the `if`, so the longer one runs unindented
 * (see "Put the shorter branch in the `if`" in docs/guidelines/principles.md). Branches are
 * measured in lines of code, since the cost is how much indented code a reader scans and oxfmt
 * decides every line break. Comments and the statement that ends the `if` block don't count.
 */

type Statement = { type: string; loc: { start: { line: number }; end: { line: number } } };

/** Statements that leave the block, which make the code after the `if` the other branch. */
const ENDINGS = new Set([
  "ReturnStatement",
  "ThrowStatement",
  "ContinueStatement",
  "BreakStatement",
]);

const countLines = (statements: readonly Statement[]): number =>
  statements.reduce(
    (sum, statement) => sum + statement.loc.end.line - statement.loc.start.line + 1,
    0,
  );

export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Asks for the shorter of two branches inside the `if`." },
  },
  create(context) {
    return {
      IfStatement(node) {
        if (node.alternate !== null || node.consequent.type !== "BlockStatement") return;
        const inside: Statement[] = node.consequent.body;
        const ending = inside.at(-1);
        if (ending === undefined || !ENDINGS.has(ending.type)) return;
        // The statements after the if in the block or file that holds it.
        const parent = node.parent;
        if (parent.type !== "BlockStatement" && parent.type !== "Program") return;
        const siblings: readonly Statement[] = parent.body;
        const after = siblings.slice(siblings.indexOf(node) + 1);
        if (after.length === 0) return;
        const insideLines = countLines(inside.slice(0, -1));
        const afterLines = countLines(after);
        if (insideLines <= afterLines) return;
        context.report({
          node: node.test,
          message: `The if holds the longer branch (${String(insideLines)} lines against ${String(afterLines)} after it). Turn the condition around, so the shorter branch goes inside and the longer one runs unindented.`,
        });
      },
    };
  },
});
