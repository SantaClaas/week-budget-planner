import { defineRule } from "@oxlint/plugins";

/**
 * Array methods that build an array only for the next step to throw it away are reported, so the
 * chain runs lazily with the iterator helpers instead (see Iterators in
 * docs/guidelines/typescript.md). These cases are clear without types:
 *
 * - A chain of `map`, `filter` or `flatMap` handed straight to something that takes any iterable:
 *   `new Set`, `new Map`, `new WeakSet`, `new WeakMap`, `Object.fromEntries` or `for … of`.
 * - Two or more of them in a row, or one followed by a step the iterator helpers have too (`find`,
 *   `some`, `every`, `reduce`, `forEach`).
 * - An iterator materialized into an array — either `toArray()` or an array literal holding nothing
 *   but an iterator spread, `[...rows.values()]` — before such a chain or handed straight to
 *   something that takes any iterable. Its fix chains on the iterator directly, moving `toArray()`
 *   to the end only when an array is still needed.
 * - A standalone iterator spread into an array literal of its own, `[...rows.values()]`, which
 *   `toArray()` says directly, and which the fix writes. Only a chain from `values()`, `keys()`,
 *   `entries()`, `matchAll()` or `Iterator.from()` counts, so spreading a string or an array
 *   passes.
 *
 * Lint plugins don't see types, so a chain counts as eager unless it starts from `values()`,
 * `keys()`, `entries()`, `matchAll()` or `Iterator.from()`. The fix starts it from `values()`, and
 * ends it with `toArray()` where its result is still used as an array. Where the rule guesses
 * wrong, such as a generator or a non-iterator `toArray()`, the fix doesn't compile, so the
 * typecheck catches it. It also misses an array stored in a variable before it's handed on. If
 * wrong guesses pile up or those misses matter, the check moves to a script that asks the type
 * checker, like scripts/check-must-use.ts (see "Our own checks come in two kinds" in
 * docs/guidelines/typescript.md).
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
/** The iterator helpers that give another iterator, which a chain from a lazy start goes on with. */
const ITERATOR_STEPS = new Set(["map", "filter", "flatMap", "take", "drop"]);

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

/** Whether `node` is a `toArray()` call with no arguments, returning its receiver. */
function readToArrayReceiver(node: Node): Node | undefined {
  const method = readMethod(node);
  const callArguments = node["arguments"];
  return method?.name === "toArray" && Array.isArray(callArguments) && callArguments.length === 0
    ? method.object
    : undefined;
}

/** Whether `node` is the object of a method call in `BUILDING` or `ENDING`. */
function isChainedToStep(node: Node): boolean {
  const parent = node.parent;
  if (parent?.type !== "MemberExpression" || parent["object"] !== node) return false;

  const outer = readMethod(isNode(parent.parent) ? parent.parent : null);
  return outer !== undefined && (BUILDING.has(outer.name) || ENDING.has(outer.name));
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

/** Whether `node` gives an iterator: a chain of iterator helpers from a lazy start. */
function isIterator(node: Node): boolean {
  let start = node;
  let step = readMethod(start);
  while (step !== undefined && ITERATOR_STEPS.has(step.name)) {
    start = step.object;
    step = readMethod(start);
  }

  return (step !== undefined && LAZY_STARTS.has(step.name)) || isIteratorFrom(start);
}

/** The iterator an array literal holds nothing but, spread, as in `[...rows.values()]`. */
function readSpreadIterator(node: Node): Node | undefined {
  const elements = node["elements"];
  if (!Array.isArray(elements) || elements.length !== 1) return undefined;

  const element: unknown = elements[0];
  if (!isNode(element) || element.type !== "SpreadElement") return undefined;

  const argument = element["argument"];
  return isNode(argument) && isIterator(argument) ? argument : undefined;
}

/**
 * An iterator materialized into an array at the start of a chain — either `iter.toArray()` or
 * `[...iter]` — with the range and replacement that unwrap it back to the iterator.
 */
function readMaterializedIterator(
  node: Node,
  sourceText: string,
): { range: [number, number]; replacement: string; messagePrefix: string } | undefined {
  const receiver = readToArrayReceiver(node);
  if (receiver !== undefined) {
    return {
      range: [receiver.range[1], node.range[1]],
      replacement: "",
      messagePrefix: "This calls toArray()",
    };
  }

  const iterator = readSpreadIterator(node);
  if (iterator === undefined) return undefined;

  return {
    range: node.range,
    replacement: sourceText.slice(...iterator.range),
    messagePrefix: "This spreads an iterator into an array",
  };
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
      ArrayExpression(raw) {
        const node: unknown = raw;
        if (!isNode(node)) return;

        const iterator = readSpreadIterator(node);
        if (iterator === undefined || isChainedToStep(node)) return;

        const isIterable = isTakenAsIterable(node);
        const iteratorText = context.sourceCode.text.slice(...iterator.range);
        context.report({
          node,
          message: isIterable
            ? "This spreads an iterator into an array only to iterate it again. Pass the iterator directly."
            : "This spreads an iterator into an array. Call toArray() on it instead.",
          fix: (fixer) =>
            fixer.replaceTextRange(
              node.range,
              isIterable ? iteratorText : `${iteratorText}.toArray()`,
            ),
        });
      },
      CallExpression(raw) {
        const node: unknown = raw;
        if (!isNode(node)) return;

        const toArrayReceiver = readToArrayReceiver(node);
        if (toArrayReceiver !== undefined) {
          if (!isChainedToStep(node) && isTakenAsIterable(node)) {
            context.report({
              node,
              message:
                "This calls toArray() only to iterate the result again. Pass the iterator directly.",
              fix: (fixer) => fixer.removeRange([toArrayReceiver.range[1], node.range[1]]),
            });
          }

          return;
        }

        const top = readMethod(node);
        if (top === undefined || !(BUILDING.has(top.name) || ENDING.has(top.name))) return;

        // Only the outermost step of a chain reports, so a chain is reported once.
        if (isChainedToStep(node)) return;

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

        const isIterable = BUILDING.has(top.name) && isTakenAsIterable(node);
        const needsArray = BUILDING.has(top.name) && !isIterable;
        const materialized = readMaterializedIterator(start, context.sourceCode.text);
        if (materialized !== undefined) {
          context.report({
            node,
            message: needsArray
              ? `${materialized.messagePrefix} before chaining array methods, building an array only to throw it away. Chain on the iterator and call toArray() at the end.`
              : `${materialized.messagePrefix} before a chain that iterators support too. Chain on the iterator directly.`,
            fix: (fixer) => {
              const unwrap = fixer.replaceTextRange(materialized.range, materialized.replacement);
              return needsArray
                ? [unwrap, fixer.insertTextAfterRange(node.range, ".toArray()")]
                : unwrap;
            },
          });
          return;
        }

        const isLazy = (step !== undefined && LAZY_STARTS.has(step.name)) || isIteratorFrom(start);
        if (isLazy) return;

        const stepsInBetween = building - (BUILDING.has(top.name) ? 1 : 0);
        if (stepsInBetween === 0 && !isIterable) return;

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
