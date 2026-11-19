import { defineRule } from "@oxlint/plugins";

/**
 * Array methods that build an array only for the next step to throw it away are reported, so the
 * chain runs lazily with the iterator helpers instead (see Iterators in
 * docs/guidelines/typescript.md). Two cases are clear without types:
 *
 * - A chain of `map`, `filter` or `flatMap` handed straight to something that takes any iterable:
 *   `new Set`, `new Map`, `new WeakSet`, `new WeakMap`, `Object.fromEntries` or `for … of`.
 * - Two or more of them in a row, or one followed by a step the iterator helpers have too (`find`,
 *   `some`, `every`, `reduce`, `forEach`).
 *
 * Lint plugins don't see types, so a chain counts as eager unless it starts from `values()`,
 * `keys()`, `entries()`, `matchAll()` or `Iterator.from()`. The fix starts it from `values()`, and
 * ends it with `toArray()` where its result is still used as an array. Where the rule guesses
 * wrong, such as a generator, the fix doesn't compile, so the typecheck catches it. It also misses
 * an array stored in a variable before it's handed on. If wrong guesses pile up or those misses
 * matter, the check moves to a script that asks the type checker, like scripts/check-must-use.ts
 * (see "Our own checks come in two kinds" in docs/guidelines/typescript.md).
 */

type Node = { type: string; range: [number, number]; parent: Node | null } & Record<
  string,
  unknown
>;

/** Steps that build a new array, and that the iterator helpers do lazily. */
const BUILDING = new Set(["map", "filter", "flatMap"]);
/** Steps that end a chain with something other than an array, on arrays and iterators alike. */
const ENDING = new Set(["find", "some", "every", "reduce", "forEach"]);
/** Calls that give an iterator, so the steps after them are the iterator helpers already. */
const LAZY_STARTS = new Set(["values", "keys", "entries", "matchAll"]);
const ITERABLE_CONSTRUCTORS = new Set(["Set", "Map", "WeakSet", "WeakMap"]);

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value;

/** The method a call calls, as in `list.map(…)`, or undefined when it isn't a plain method call. */
function readMethod(node: Node | null): { name: string; object: Node; property: Node } | undefined {
  if (node?.type !== "CallExpression") return undefined;

  const callee = node["callee"];
  if (!isNode(callee) || callee.type !== "MemberExpression" || callee["computed"] === true) {
    return undefined;
  }

  const property = callee["property"];
  const object = callee["object"];
  if (!isNode(property) || !isNode(object) || property.type !== "Identifier") return undefined;

  const name = property["name"];
  return typeof name === "string" ? { name, object, property } : undefined;
}

/** Whether `node` is `Iterator.from(…)`. */
function isIteratorFrom(node: Node): boolean {
  const method = readMethod(node);
  return (
    method?.name === "from" &&
    method.object.type === "Identifier" &&
    method.object["name"] === "Iterator"
  );
}

/** Whether the value of `node` is taken by something that accepts any iterable. */
function isTakenAsIterable(node: Node): boolean {
  const parent = node.parent;
  if (parent === null) return false;

  if (parent.type === "ForOfStatement") return parent["right"] === node;

  const callee = parent["callee"];
  const parentArguments = parent["arguments"];
  if (!isNode(callee) || !Array.isArray(parentArguments) || parentArguments[0] !== node) {
    return false;
  }

  if (parent.type === "NewExpression") {
    return callee.type === "Identifier" && ITERABLE_CONSTRUCTORS.has(String(callee["name"]));
  }

  const method = readMethod(parent);
  return (
    method?.name === "fromEntries" &&
    method.object.type === "Identifier" &&
    method.object["name"] === "Object"
  );
}

export default defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "Asks for the iterator helpers where array methods build arrays in between.",
    },
  },
  create(context) {
    return {
      CallExpression(raw) {
        const node: unknown = raw;
        if (!isNode(node)) return;

        const top = readMethod(node);
        if (top === undefined || !(BUILDING.has(top.name) || ENDING.has(top.name))) return;

        // Only the outermost step of a chain reports, so a chain is reported once.
        const outer = node.parent;
        const outerMethod = readMethod(isNode(outer?.parent) ? outer.parent : null);
        const isInner =
          outer?.type === "MemberExpression" &&
          outer["object"] === node &&
          outerMethod !== undefined &&
          (BUILDING.has(outerMethod.name) || ENDING.has(outerMethod.name));
        if (isInner) return;

        // Walk down to where the chain starts, counting the steps that build an array.
        let building = BUILDING.has(top.name) ? 1 : 0;
        let first = top;
        let start = top.object;
        let step = readMethod(start);
        while (step !== undefined && BUILDING.has(step.name)) {
          building += 1;
          first = step;
          start = step.object;
          step = readMethod(start);
        }

        const isLazy = (step !== undefined && LAZY_STARTS.has(step.name)) || isIteratorFrom(start);
        if (isLazy) return;

        const isIterable = BUILDING.has(top.name) && isTakenAsIterable(node);
        const stepsInBetween = building - (BUILDING.has(top.name) ? 1 : 0);
        if (stepsInBetween === 0 && !isIterable) return;

        const needsArray = BUILDING.has(top.name) && !isIterable;
        context.report({
          node,
          message: needsArray
            ? "This chain builds an array at every step only to throw it away. Start it with values() and end it with toArray()."
            : "This chain builds arrays only to throw them away. Start it with values(), so it runs lazily with the iterator helpers.",
          fix: (fixer) => {
            // Before the first method's name, so parentheses around the start stay outside.
            const startFix = fixer.insertTextBeforeRange(first.property.range, "values().");
            return needsArray
              ? [startFix, fixer.insertTextAfterRange(node.range, ".toArray()")]
              : startFix;
          },
        });
      },
    };
  },
});
