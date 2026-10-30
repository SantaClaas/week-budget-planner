// Serves the built app (dist/) for the browser tests, the way a static host does:
//
//   node e2e/static-server.ts --port 4311 --isolated   with the cross-origin isolation headers
//   node e2e/static-server.ts --port 4312              without them, like GitHub Pages
//
// Without the headers, the app's service worker has to add them, as it does in production.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { port: { type: "string" }, isolated: { type: "boolean", default: false } },
});
const port = Number(values.port);
if (!Number.isInteger(port)) throw new TypeError("Pass the port, for example --port 4311.");

const BASE = "/week-budget-planner/";
const root = new URL("../dist/", import.meta.url).pathname;
const CONTENT_TYPES = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"],
]);
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
  if (!path.startsWith(BASE)) {
    response.writeHead(404).end();
    return;
  }
  const relative = normalize(path.slice(BASE.length) || "index.html").replace(/^(\.\.[/\\])+/u, "");
  const file = join(root, relative.endsWith("/") ? `${relative}index.html` : relative);
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES.get(extname(file)) ?? "application/octet-stream",
    ...(values.isolated && isolation),
  });
  response.end(body);
}

createServer((request, response) => {
  void serve(request, response);
}).listen(port);
