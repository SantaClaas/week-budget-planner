/**
 * The transport check (transport-check.html): starts the transport's worker, connects to the
 * server's node through the server's relay, and sends bytes that the node's echo protocol sends back
 * (see crates/server/src/node.rs). Nothing in the app turns syncing on yet, so this page is how the
 * browser test, and a person, run the transport under the app's headers and policy. "Send again"
 * echoes once more with the same node, for example after the relay dropped.
 *
 * `?timeout=<milliseconds>` sets each step's deadline; it's 10 s without one, and the check ends in
 * "invalid-timeout" for one that isn't a whole number above zero.
 */
import type { Result } from "../result.ts";
import { start, type Problem, type StreamHandle, type Transport } from "./index.ts";

/**
 * The page's default Trusted Types policy, which the policy requires before the worker starts: the
 * worker's URL is same-origin, and the page writes no HTML. Its own rather than the app's
 * src/trusted-html.ts, so the two pages share no code and the app's page loads nothing more for
 * this one.
 */
globalThis.trustedTypes?.createPolicy("default", {
  createHTML: () => null,
  createScriptURL: (input) =>
    new URL(input, location.href).origin === location.origin ? input : null,
});

/** The echo protocol's name: `ECHO` in crates/server/src/node.rs. */
const ECHO = "week-budget-planner/echo/0";
const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;
/** The most bytes one receive takes. */
const RECEIVE_LIMIT = 64 * 1024;
const MESSAGE = "a block from the browser";

/**
 * Why the server's node couldn't be found: nothing answered at the origin ("no-server"), something
 * answered without a node, such as GitHub Pages ("no-node"), or `/node` didn't describe one
 * ("unreadable-node").
 */
type ServerProblem = "no-server" | "no-node" | "unreadable-node";

/** Where a check ended: "echoed", or what went wrong. */
type Outcome = "echoed" | "mismatch" | "invalid-timeout" | ServerProblem | Problem;

/**
 * Each step's deadline from `?timeout=`: the default without one, and "invalid-timeout" for one
 * that isn't a whole number of milliseconds above zero, rather than quietly using the default.
 *
 * @param search - The page's query, as `location.search` gives it.
 */
function readTimeout(search: string): Result<number, "invalid-timeout"> {
  const text = new URLSearchParams(search).get("timeout");
  if (text === null) return DEFAULT_TIMEOUT_MILLISECONDS;

  const value = Number(text);
  return /^\d+$/u.test(text) && value > 0 ? value : "invalid-timeout";
}

/** The node id in `/node`'s body, `{"nodeId":"…"}` (crates/server/src/node.rs). */
function readNode(description: unknown): Result<{ nodeId: string }, "unreadable-node"> {
  if (typeof description !== "object" || description === null || !("nodeId" in description)) {
    return "unreadable-node";
  }

  return typeof description.nodeId === "string"
    ? { nodeId: description.nodeId }
    : "unreadable-node";
}

/** The server's node, as the server itself describes it at `/node`. */
async function findServer(): Promise<Result<{ nodeId: string }, ServerProblem>> {
  let response: Response;
  try {
    response = await fetch(new URL("/node", location.origin), { cache: "no-store" });
  } catch {
    return "no-server";
  }

  if (!response.ok) return "no-node";

  let description: unknown;
  try {
    description = await response.json();
  } catch {
    return "unreadable-node";
  }

  return readNode(description);
}

/** Reads the stream until the other side finishes. */
async function receiveAll(
  transport: Transport,
  stream: StreamHandle,
  timeout: number,
): Promise<{ text: string } | Problem> {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    // One chunk after another, in order, until the node finishes.
    // oxlint-disable-next-line no-await-in-loop -- a stream's chunks arrive in order.
    const chunk = await transport.receive(stream, RECEIVE_LIMIT, timeout);
    if (chunk === null) return { text };

    if (typeof chunk === "string") return chunk;

    text += decoder.decode(chunk, { stream: true });
  }
}

/**
 * Connects to the server's node, sends the message on a stream, and checks what comes back. The
 * stream and the connection close when it returns, however it returns, through their dispose
 * functions.
 */
async function echo(transport: Transport, serverId: string, timeout: number): Promise<Outcome> {
  const connected = await transport.connect(serverId, ECHO, timeout);
  if (typeof connected === "string") return connected;

  await using connection = connected;
  const opened = await transport.open(connection, timeout);
  if (typeof opened === "string") return opened;

  await using stream = opened;
  const sent = await transport.send(stream, new TextEncoder().encode(MESSAGE), timeout);
  if (sent !== "sent") return sent;

  const finished = await transport.finish(stream);
  if (finished !== "finished") return finished;

  const received = await receiveAll(transport, stream, timeout);
  if (typeof received === "string") return received;

  return received.text === MESSAGE ? "echoed" : "mismatch";
}

const output = document.querySelector("output");
const again = document.querySelector("button");

function report(outcome: Outcome, startedAt: number): void {
  console.info(`[transport] ${outcome} after ${Math.round(performance.now() - startedAt)} ms`);
  document.documentElement.dataset["outcome"] = outcome;
  if (output !== null) output.value = outcome;
}

/** Runs one echo, and shows how it ended. */
async function runEcho(transport: Transport, serverId: string, timeout: number): Promise<void> {
  const startedAt = performance.now();
  delete document.documentElement.dataset["outcome"];
  if (output !== null) output.value = "running";

  report(await echo(transport, serverId, timeout), startedAt);
}

async function runCheck(): Promise<void> {
  // `using` needs the disposal symbols, which Safari doesn't have yet: the app's polyfill, in a
  // chunk of its own (see src/polyfill/index.ts).
  if (!("AsyncDisposableStack" in globalThis)) await import("../polyfill/disposal.ts");

  const startedAt = performance.now();
  const timeout = readTimeout(location.search);
  if (timeout === "invalid-timeout") {
    report(timeout, startedAt);
    return;
  }

  const server = await findServer();
  if (typeof server === "string") {
    report(server, startedAt);
    return;
  }

  const serverId = server.nodeId;

  const transport = start();
  const spawned = await transport.spawn(
    crypto.getRandomValues(new Uint8Array(32)),
    location.origin,
    timeout,
  );
  if (typeof spawned === "string") {
    report(spawned, startedAt);
    return;
  }

  await runEcho(transport, serverId, timeout);
  if (again === null) return;

  again.hidden = false;
  again.addEventListener("click", () => {
    runEcho(transport, serverId, timeout).catch((error: unknown) => {
      console.error("[transport]", error);
    });
  });
}

// A mistake, such as a worker that failed, shows in the console and leaves the result "running".
try {
  await runCheck();
} catch (error) {
  console.error("[transport]", error);
}
