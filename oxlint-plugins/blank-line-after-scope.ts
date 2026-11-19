import { defineRule } from "@oxlint/plugins";

/**
 * A statement that opens a scope (an `if` with its `else`, a loop, a `try`, a `switch`, a bare
 * block) is followed by a blank line when another statement comes after it in the same scope (see
 * Formatting and linting in docs/guidelines/typescript.md). An `if` without braces opens a scope as
 * much as one with them, so a guard that returns on one line counts too, and so does each of
 * several `if`s in a row. Where the scope around it ends right after, nothing is asked: the closing
 * brace follows. oxfmt keeps a blank line but never adds one, so the fix adds it.
 */

type Ranged = { type: string; range: [number, number] };

/** A node that may hold a list of statements: a block, a file, a `case`. */
type Parent = { type: string; body?: unknown; consequent?: unknown };

/** A line break, any spaces, then another line break: an empty line. */
const BLANK_LINE = /\n[\t ]*\r?\n/u;

/** The statements of the scope `parent` opens, or undefined when it doesn't hold a list of them. */
function readStatements(parent: Parent | null): readonly Ranged[] | undefined {
  if (parent === null) return undefined;

  const list = parent.type === "SwitchCase" ? parent.consequent : parent.body;
  return Array.isArray(list) ? list : undefined;
}

export default defineRule({
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: { description: "Asks for a blank line after a statement that opens a scope." },
  },
  create(context) {
    const text = context.sourceCode.text;
    const check = (node: Ranged & { parent: Parent | null }): void => {
      const statements = readStatements(node.parent);
      if (statements === undefined) return;

      const next = statements[statements.indexOf(node) + 1];
      if (next === undefined) return;

      const end = node.range[1];
      const between = text.slice(end, next.range[0]);
      if (BLANK_LINE.test(between)) return;

      // After the end of the line, so a comment on the same line stays there.
      const lineBreak = between.indexOf("\n");
      context.report({
        node,
        message:
          "Leave a blank line after a statement that opens a scope, before the next statement in the same scope.",
        fix: (fixer) =>
          lineBreak === -1
            ? fixer.insertTextAfterRange([end, end], "\n\n")
            : fixer.insertTextAfterRange([end + lineBreak, end + lineBreak], "\n"),
      });
    };
    return {
      IfStatement: check,
      ForStatement: check,
      ForInStatement: check,
      ForOfStatement: check,
      WhileStatement: check,
      DoWhileStatement: check,
      TryStatement: check,
      SwitchStatement: check,
      BlockStatement: check,
      LabeledStatement: check,
    };
  },
});
