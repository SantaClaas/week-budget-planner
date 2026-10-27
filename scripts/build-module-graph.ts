// Builds docs/MODULES.md: a Mermaid graph of which of the app's modules import which.
//
//   node scripts/build-module-graph.ts
//
// A module is a folder directly in src/ (src/plan/, src/storage/) or a file directly in it
// (src/App.tsx). Imports between files of the same module, and of files outside src/, don't show.
// Every import counts, type-only ones too, since they couple the modules all the same. Its test
// fails when the graph has a cycle, because dependencies go one way (see Coupling in
// docs/guidelines/principles.md), and when docs/MODULES.md is out of date.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceFolder = join(root, "src");
const output = join(root, "docs/MODULES.md");

/** `import … from "./x"`, `export … from "./x"` and `import "./x"`, relative paths only. */
const STATIC_IMPORT = /\b(?:from|import)\s+"(\.{1,2}\/[^"]+)"/gu;
/** `import("./x")`, which Vite turns into a chunk of its own. */
const DYNAMIC_IMPORT = /\bimport\(\s*"(\.{1,2}\/[^"]+)"\s*\)/gu;

/** Imports from one module to another; `isDynamic` when every import between them is dynamic. */
type Graph = Map<string, Map<string, { isDynamic: boolean }>>;

/** The module a file in src/ belongs to: its folder there, or the file's own name. */
export function findModule(path: string): string {
  const [first = "", ...rest] = path.split("/");
  return rest.length > 0 ? first : first.slice(0, first.length - extname(first).length);
}

function listSourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .values()
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .filter((entry) => !/\.(test|d)\.tsx?$/u.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .toArray();
}

/** Reads the imports of every file in src/, except tests, into a graph of modules. */
export function readGraph(folder = sourceFolder): Graph {
  const graph: Graph = new Map();
  for (const file of listSourceFiles(folder)) {
    const from = findModule(relative(folder, file).replaceAll("\\", "/"));
    const edges = graph.get(from) ?? new Map<string, { isDynamic: boolean }>();
    graph.set(from, edges);
    const text = readFileSync(file, "utf8");
    const imports = [
      ...text.matchAll(STATIC_IMPORT).map((match) => ({ path: match[1], isDynamic: false })),
      ...text.matchAll(DYNAMIC_IMPORT).map((match) => ({ path: match[1], isDynamic: true })),
    ];
    for (const { path = "", isDynamic } of imports) {
      // Vite's queries, such as ?no-inline, aren't part of the path.
      const target = relative(folder, resolve(dirname(file), path.replace(/\?.*$/u, "")));
      // Files outside src/, such as the example week's JSON, aren't modules of the app.
      if (target.startsWith("..")) continue;
      const to = findModule(target.replaceAll("\\", "/"));
      if (to === from) continue;
      edges.set(to, { isDynamic: (edges.get(to)?.isDynamic ?? true) && isDynamic });
    }
  }
  return graph;
}

/** Groups of modules that import each other, directly or through others (Tarjan's algorithm). */
export function findCycles(graph: Graph): string[][] {
  const order = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (module: string): void => {
    order.set(module, order.size);
    lowest.set(module, order.size - 1);
    stack.push(module);
    for (const next of graph.get(module)?.keys() ?? []) {
      if (!order.has(next)) {
        visit(next);
        lowest.set(module, Math.min(lowest.get(module) ?? 0, lowest.get(next) ?? 0));
        continue;
      }
      if (stack.includes(next)) {
        lowest.set(module, Math.min(lowest.get(module) ?? 0, order.get(next) ?? 0));
      }
    }
    if (lowest.get(module) !== order.get(module)) return;
    const group: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) group.push(member);
    } while (member !== undefined && member !== module);
    if (group.length > 1) cycles.push(group.toSorted());
  };
  for (const module of graph.keys()) if (!order.has(module)) visit(module);
  return cycles;
}

/** A Mermaid node id. Module names can hold "-", and Mermaid reserves words such as `end`. */
const toId = (module: string): string => `module_${module.replaceAll(/\W/gu, "_")}`;

/** The text of docs/MODULES.md for the graph. */
export function render(graph: Graph): string {
  const modules = new Set([...graph.keys(), ...graph.values().flatMap((edges) => edges.keys())]);
  const nodes = [...modules].toSorted().map((module) => `  ${toId(module)}["${module}"]`);
  const edges = [...graph.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([from, targets]) =>
      [...targets.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([to, { isDynamic }]) => `  ${toId(from)} ${isDynamic ? "-.->" : "-->"} ${toId(to)}`),
    );
  return `<!-- Generated by scripts/build-module-graph.ts. Don't edit by hand: run \`pnpm modules\`. -->

# Modules

Which of the app's modules in [\`src/\`](../src/) import which. A module is a folder directly in \`src/\` or a file directly in it. An arrow points from the importer to what it imports, and a dashed arrow is a dynamic \`import()\`, which loads only when it's needed (see [\`docs/LOADING.md\`](LOADING.md)).

Dependencies go one way (see Coupling in [\`docs/guidelines/principles.md\`](guidelines/principles.md)), so the graph has no cycles, and a test fails when one appears. The same test fails when this file is out of date: run \`pnpm modules\` after changing imports between modules.

\`\`\`mermaid
flowchart LR
${[...nodes, ...edges].join("\n")}
\`\`\`
`;
}

if (import.meta.main) {
  writeFileSync(output, render(readGraph()));
  console.log(`Wrote ${relative(root, output)}`);
}
