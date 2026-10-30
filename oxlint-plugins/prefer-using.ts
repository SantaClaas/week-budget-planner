import { defineRule } from "@oxlint/plugins";

/**
 * Every `finally` is reported: a cleanup that runs however a scope ends is a `using` or `await
 * using` declaration, with `DisposableStack` or `AsyncDisposableStack` for resources that aren't
 * disposable yet (see "Clean up with `using`" in docs/guidelines/principles.md). Where a `finally`
 * really is the clearest way, the line disables the rule and says why.
 */
export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Asks for `using` instead of `finally`." },
  },
  create(context) {
    return {
      TryStatement(node) {
        if (node.finalizer === null) return;
        context.report({
          node: node.finalizer,
          message:
            "Clean up with using instead of finally: adopt the resource or defer the cleanup on a DisposableStack or AsyncDisposableStack.",
        });
      },
    };
  },
});
