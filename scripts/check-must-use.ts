// Fails where a value that must be used is thrown away, like Rust's `must_use` lint:
//
//   node scripts/check-must-use.ts
//
// `pnpm typecheck` runs it after tsc. A value must be used when its type is a `Result` (from
// src/result.ts, or any type alias named Result), or when the function that returned it has a
// `@mustUse` tag in its JSDoc. A call is thrown away when it's a statement of its own, awaited or
// not. `void` in front of it says that's on purpose. Promises are the lint's job
// (typescript/no-floating-promises). See Results in docs/guidelines/typescript.md.
//
// TypeScript 7 has no plugins, so this asks its type checker through the API it ships as
// `typescript/unstable/sync`, which may still change between versions. The tests pin down what it
// relies on.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { API, type Checker, type Type } from "typescript/unstable/sync";
import type { Expression, Node, SourceFile } from "typescript/unstable/ast";
import {
  isAwaitExpression,
  isCallExpression,
  isExpressionStatement,
  isNewExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
} from "typescript/unstable/ast/is";

const root = fileURLToPath(new URL("../", import.meta.url));

/** The project configs that `tsc -b` checks: the references in the folder's tsconfig.json. */
function readConfigs(folder: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(folder, "tsconfig.json"), "utf8"));
  const references =
    typeof parsed === "object" && parsed !== null && "references" in parsed
      ? parsed.references
      : undefined;
  if (!Array.isArray(references)) throw new Error("tsconfig.json has no references.");
  return references.map((reference: unknown) => {
    if (typeof reference !== "object" || reference === null || !("path" in reference)) {
      throw new Error("A reference in tsconfig.json has no path.");
    }
    return join(folder, String(reference.path));
  });
}

type Finding = { file: string; line: number; column: number; message: string };

/** The call a statement stands for, through parentheses and `await`; undefined for anything else. */
function findCall(expression: Expression): Expression | undefined {
  if (isParenthesizedExpression(expression) || isAwaitExpression(expression)) {
    return findCall(expression.expression);
  }
  return isCallExpression(expression) || isNewExpression(expression) ? expression : undefined;
}

const isResult = (type: Type | undefined): boolean => type?.getAliasSymbol()?.name === "Result";

/** Whether the function called has `@mustUse` in its JSDoc. */
function isMarkedMustUse(checker: Checker, call: Expression): boolean {
  if (!isCallExpression(call) && !isNewExpression(call)) return false;
  const callee = isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  const symbol = checker.getSymbolAtLocation(callee);
  return symbol?.getJsDocTags(checker).some((tag) => tag.name === "mustUse") ?? false;
}

function findLineAndColumn(file: SourceFile, position: number): { line: number; column: number } {
  const before = file.text.slice(0, position);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: position - lineStart + 1 };
}

/** Every statement in the files that throws away a value that must be used. */
function checkFile(checker: Checker, file: SourceFile, folder: string): Finding[] {
  const findings: Finding[] = [];
  const visit = (node: Node): void => {
    if (isExpressionStatement(node)) {
      const call = findCall(node.expression);
      if (call) {
        // The statement's type is the call's, awaited when it's awaited.
        const type = checker.getTypeAtLocation(node.expression);
        const reason = isResult(type)
          ? `its Result (${type ? checker.typeToString(type) : "unknown"})`
          : isMarkedMustUse(checker, call)
            ? "a value marked @mustUse"
            : undefined;
        if (reason !== undefined) {
          // Positions include the whitespace and comments before a node; the code starts after it.
          const text = file.text.slice(node.pos, node.end);
          const start = node.pos + (text.length - text.trimStart().length);
          findings.push({
            file: relative(folder, file.fileName),
            ...findLineAndColumn(file, start),
            message: `This throws away ${reason}. Use it, or put void in front if that's on purpose.`,
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(file);
  return findings;
}

/** Checks every file of the folder's projects, each file once, outside node_modules. */
export function check(folder = root): Finding[] {
  const configs = readConfigs(folder);
  using resources = new DisposableStack();
  const api = resources.adopt(new API({ cwd: folder }), (opened) => {
    opened.close();
  });
  const snapshot = api.updateSnapshot({ openProjects: configs });
  const findings: Finding[] = [];
  const checked = new Set<string>();
  for (const config of configs) {
    const project = snapshot.getProject(config);
    if (!project) throw new Error(`TypeScript couldn't open ${relative(folder, config)}.`);
    for (const name of project.program.getSourceFileNames()) {
      if (name.includes("/node_modules/") || checked.has(name)) continue;
      checked.add(name);
      const file = project.program.getSourceFile(name);
      if (file) findings.push(...checkFile(project.checker, file, folder));
    }
  }
  return findings;
}

if (import.meta.main) {
  const findings = check();
  for (const { file, line, column, message } of findings) {
    console.error(`${file}:${line}:${column}: ${message}`);
  }
  if (findings.length > 0) process.exitCode = 1;
}
