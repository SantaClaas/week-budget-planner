// Static server for the spike page, with the app's headers:
// cross-origin isolation (COOP/COEP) and a Content Security Policy with
// Trusted Types, sent as headers. The policy variant comes from the `csp`
// query parameter of each document request (the page and its worker):
//   app     – the app's policy as in docs/spec/security.md (no connect-src)
//   relay   – the app's policy plus connect-src for the relay on another port
//   public  – the app's policy plus connect-src for n0's relays and DNS
// It also forwards /relay (WebSocket) and /ping to the relay, so the relay
// can be reached on the page's own origin.
//
//   node serve.mjs [port] [relay port]

import { createReadStream, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { extname, join, normalize } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.argv[2] ?? 8080);
const relayPort = Number(process.argv[3] ?? 3340);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

const appPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "require-trusted-types-for 'script'",
  "trusted-types default",
];

function policyFor(variant) {
  if (variant === "public") {
    return [
      ...appPolicy,
      "connect-src 'self' https://*.relay.n0.iroh.link wss://*.relay.n0.iroh.link https://dns.iroh.link",
    ].join("; ");
  }
  // iroh's default relay URLs are fully qualified, with a trailing dot
  // ("https://use1-1.relay.n0.iroh.link./"), which the plain host doesn't match.
  if (variant === "public-dot") {
    return [
      ...appPolicy,
      "connect-src 'self' https://*.relay.n0.iroh.link. wss://*.relay.n0.iroh.link. https://dns.iroh.link",
    ].join("; ");
  }
  // Only the WebSocket: the relay's HTTPS latency probe (/ping) is blocked.
  if (variant === "relay-websocket-only") {
    return [...appPolicy, `connect-src 'self' ws://localhost:${relayPort}`].join("; ");
  }
  if (variant !== "relay") return appPolicy.join("; ");
  return [
    ...appPolicy,
    `connect-src 'self' http://localhost:${relayPort} ws://localhost:${relayPort}`,
  ].join("; ");
}

function forward(incoming, outgoing) {
  const proxied = request(
    { host: "127.0.0.1", port: relayPort, path: incoming.url, method: incoming.method, headers: incoming.headers },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    },
  );
  proxied.on("error", () => outgoing.writeHead(502).end());
  incoming.pipe(proxied);
}

const server = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/relay" || url.pathname === "/ping") {
    forward(incoming, outgoing);
    return;
  }
  const path = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(root) || !statSync(path, { throwIfNoEntry: false })?.isFile()) {
    outgoing.writeHead(404).end();
    return;
  }
  const headers = {
    "Content-Type": types[extname(path)] ?? "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cache-Control": "no-store",
  };
  if (path.endsWith(".html") || path.endsWith("worker.js")) {
    headers["Content-Security-Policy"] = policyFor(url.searchParams.get("csp"));
  }
  outgoing.writeHead(200, headers);
  createReadStream(path).pipe(outgoing);
});

// WebSocket upgrades on /relay go to the relay as raw bytes.
server.on("upgrade", (incoming, socket, head) => {
  const upstream = connect(relayPort, "127.0.0.1", () => {
    const lines = [`${incoming.method} ${incoming.url} HTTP/1.1`];
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      lines.push(`${incoming.rawHeaders[index]}: ${incoming.rawHeaders[index + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://localhost:${port}`));
