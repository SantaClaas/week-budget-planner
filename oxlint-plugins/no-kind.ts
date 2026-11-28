import { defineRule } from "@oxlint/plugins";

/**
 * Every name `kind` that the code declares is reported: a variable, a parameter, a property of an
 * object, a type or a class. "Kind" says only that values differ, not how. A field that tells the
 * shapes of a union apart is `type`, and any other field gets a name for what it means (see
 * Discriminated unions in docs/guidelines/typescript.md).
 *
 * A name read from someone else's object (`node.kind` in the TypeScript API, or `{ kind: part }`
 * to take it under another name) isn't ours, so it passes. Where a library makes us write one, the
 * line disables the rule and says why.
 *
 * It goes by shape: it sees which identifiers declare a name, not types, so a name declared through
 * a shape it doesn't list here, such as an enum member or a namespace, passes unnoticed.
 */
const NAME = "kind";

export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Asks for a name that says what it means instead of `kind`." },
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name !== NAME) return;

        /** Whether the identifier declares the name, as opposed to reading one. */
        const isDeclared = (): boolean => {
          const parent = node.parent;
          // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- the parent can be any of the tree's node types; only the ones that declare a name have a case, and the rest are false.
          switch (parent.type) {
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
              // A function's parameters have the function as their parent, as its name does.
              return (
                ("id" in parent && parent.id === node) ||
                parent.params.some((parameter) => parameter === node)
              );
            case "VariableDeclarator":
            case "ClassDeclaration":
            case "ClassExpression":
            case "TSTypeAliasDeclaration":
            case "TSInterfaceDeclaration":
              return parent.id === node;
            case "Property":
              // In an object literal the key is ours. In a pattern, `{ kind }` declares it, while
              // `{ kind: part }` takes someone else's field under a name of its own.
              return parent.parent.type === "ObjectExpression"
                ? parent.key === node
                : parent.value === node;
            case "PropertyDefinition":
            case "MethodDefinition":
            case "TSPropertySignature":
            case "TSMethodSignature":
              return parent.key === node && !parent.computed;
            case "AssignmentPattern":
              return parent.left === node;
            case "ArrayPattern":
            case "RestElement":
            case "CatchClause":
              return true;
            default:
              return false;
          }
        };
        if (!isDeclared()) return;

        context.report({
          node,
          message:
            'Name it for what it means, not "kind": a field that tells the shapes of a union apart is `type`, and any other gets a name of its own (see Discriminated unions in docs/guidelines/typescript.md).',
        });
      },
    };
  },
});
