import { definePlugin, defineRule } from "@oxlint/plugins";

/**
 * Every comment that turns a lint rule off has to say why, after `--`:
 *
 *   // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connect() isn't typed.
 *
 * TypeScript's own `@ts-expect-error` is covered by `typescript/ban-ts-comment`, which asks for a
 * description the same way (see Formatting and linting in docs/CODING-GUIDELINES.md).
 */

/** Long enough to say something, short enough not to invite padding. */
const MINIMUM_REASON_LENGTH = 10;

/** `oxlint-disable`, `-line` or `-next-line`, and the same for `eslint-`, which oxlint also obeys. */
const DISABLE_DIRECTIVE = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?:\s|$)/u;

/** ESLint's separator for a directive's description: two or more dashes after whitespace. */
const REASON_SEPARATOR = /\s-{2,}\s*/u;

const requireReason = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Requires a reason on every comment that disables a lint rule." },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!DISABLE_DIRECTIVE.test(comment.value)) continue;
          const [, reason = ""] = comment.value.split(REASON_SEPARATOR, 2);
          if (reason.trim().length >= MINIMUM_REASON_LENGTH) continue;
          context.report({
            node: comment,
            message: `Say why the rule doesn't apply here, after "--", in ${MINIMUM_REASON_LENGTH.toString()} characters or more.`,
          });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "week-budget-planner" },
  rules: { "require-reason": requireReason },
});
