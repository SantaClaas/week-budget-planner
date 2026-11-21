import { defineRule, type Ranged } from "@oxlint/plugins";

/**
 * A function whose name doesn't start with a verb is reported (see Functions under Names in
 * docs/guidelines/typescript.md). The rule splits the name at its first capital, digit or
 * underscore and looks the first word up in `VERBS`. It checks function declarations, functions
 * assigned to a `const`, class methods, and the methods and function-typed properties of our own
 * interfaces and type literals. An object literal's methods aren't checked: their names come from
 * the type the object fills, often a library's (Vite's `configResolved`, Material's `tone`), and
 * where that type is ours, its declaration is checked instead.
 *
 * Skipped:
 *
 * - Names that start with a capital: Solid components and classes.
 * - Predicates, which start with `is`, `has` or `can` (see Booleans in
 *   docs/guidelines/typescript.md).
 * - Event handlers, which start with `on` like the platform's and Solid's (`onclick`, `onClick`),
 *   such as `onExternalChange` or `onMove`.
 * - Functions without parameters inside another function, and methods and function-typed
 *   properties without parameters in a type: those are Solid's derived values and accessors, named for the value they give, as
 *   in Solid's own `const doubleCount = () => count() * 2`.
 *
 * Lint plugins see no types, so the rule only knows words, not meaning, and guesses wrong in two
 * ways. A word that is both a noun and a verb (`change`, `list`, `name`, `merge`) passes either
 * way, even where the name means the noun. And a nested function without parameters is taken for
 * an accessor, so a name like `const cleanup = () => …` inside a function passes too.
 */

/**
 * The verbs a function name may start with, sorted. When a name starts with a verb that's missing,
 * add it here instead of disabling the rule; when it starts with a word that isn't a verb, rename
 * the function. `layout` stands for "lay out", as in `layoutWeek`, which reads better than
 * `layOutWeek`.
 */
const VERBS = new Set([
  "accept",
  "act",
  "add",
  "advance",
  "allow",
  "animate",
  "announce",
  "answer",
  "apply",
  "ask",
  "assign",
  "attempt",
  "blank",
  "brand",
  "bring",
  "broadcast",
  "build",
  "calculate",
  "call",
  "cancel",
  "change",
  "check",
  "choose",
  "clamp",
  "clear",
  "close",
  "collect",
  "compare",
  "compress",
  "connect",
  "construct",
  "consume",
  "convert",
  "count",
  "create",
  "cut",
  "decode",
  "delete",
  "deliver",
  "describe",
  "disconnect",
  "dismiss",
  "do",
  "download",
  "drag",
  "draw",
  "echo",
  "encode",
  "end",
  "ensure",
  "execute",
  "expect",
  "export",
  "extract",
  "fail",
  "fetch",
  "fill",
  "find",
  "finish",
  "fit",
  "focus",
  "follow",
  "format",
  "get",
  "give",
  "handle",
  "hash",
  "hide",
  "ignore",
  "import",
  "increment",
  "initialize",
  "insert",
  "instantiate",
  "issue",
  "keep",
  "layout",
  "leave",
  "list",
  "listen",
  "load",
  "make",
  "mark",
  "measure",
  "merge",
  "move",
  "name",
  "offer",
  "open",
  "parse",
  "perform",
  "pick",
  "point",
  "post",
  "prepare",
  "press",
  "preview",
  "provide",
  "push",
  "query",
  "quote",
  "read",
  "receive",
  "record",
  "reject",
  "reload",
  "remove",
  "rename",
  "render",
  "renew",
  "replace",
  "replay",
  "report",
  "request",
  "require",
  "resize",
  "resolve",
  "respond",
  "reuse",
  "revert",
  "run",
  "sample",
  "sanitize",
  "save",
  "scroll",
  "select",
  "send",
  "serialize",
  "serve",
  "set",
  "settle",
  "show",
  "shuffle",
  "slide",
  "snap",
  "sort",
  "spawn",
  "speak",
  "split",
  "spread",
  "start",
  "step",
  "stop",
  "store",
  "substitute",
  "sum",
  "summarize",
  "swap",
  "take",
  "try",
  "undo",
  "update",
  "use",
  "validate",
  "visit",
  "wait",
  "watch",
  "widen",
  "wrap",
  "write",
]);

/** First words that are skipped: predicates, which name a question, and event handlers. */
const SKIPPED_WORDS = new Set(["can", "has", "is", "on"]);

type Ancestor = { type: string; parent: Ancestor | null };

/** The name up to its first capital, digit or underscore: `open` in `openStorage`. */
function readFirstWord(name: string): string | undefined {
  return /^[a-z]+/u.exec(name)?.[0];
}

/** Whether `node` is a function inside another function. */
function isNested(node: Ancestor): boolean {
  for (let ancestor = node.parent; ancestor !== null; ancestor = ancestor.parent) {
    if (ancestor.type.endsWith("FunctionExpression") || ancestor.type === "FunctionDeclaration") {
      return true;
    }
  }

  return false;
}

export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Asks for a function name that starts with a verb." },
  },
  create(context) {
    function check(node: Ranged, name: string): void {
      const word = readFirstWord(name);
      if (word === undefined || SKIPPED_WORDS.has(word) || VERBS.has(word)) return;

      context.report({
        node,
        message: `Start the function name with a verb: "${name}" starts with "${word}". If "${word}" is a verb, add it to VERBS in oxlint-plugins/function-starts-with-verb.ts.`,
      });
    }

    return {
      FunctionDeclaration(node) {
        if (node.id === null) return;

        check(node.id, node.id.name);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || node.init === null) return;

        if (node.parent.type !== "VariableDeclaration" || node.parent.kind !== "const") return;

        const init = node.init;
        if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") return;

        if (init.params.length === 0 && isNested(node)) return;

        check(node.id, node.id.name);
      },
      MethodDefinition(node) {
        if (node.kind !== "method" || node.key.type !== "Identifier" || node.computed) return;

        check(node.key, node.key.name);
      },
      TSMethodSignature(node) {
        if (node.kind !== "method" || node.key.type !== "Identifier" || node.computed) return;

        if (node.params.length === 0) return;

        check(node.key, node.key.name);
      },
      TSPropertySignature(node) {
        if (node.key.type !== "Identifier" || node.computed) return;

        const type = node.typeAnnotation?.typeAnnotation;
        if (type?.type !== "TSFunctionType" || type.params.length === 0) return;

        check(node.key, node.key.name);
      },
    };
  },
});
