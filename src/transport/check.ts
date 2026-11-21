/**
 * The transport check (transport-check.html): starts the transport's worker, connects to the
 * server's node through the server's relay, and sends bytes that the node's echo protocol sends back
 * (see crates/server/src/node.rs). Nothing in the app turns syncing on yet, so this page is how the
 * browser test, and a person, run the transport under the app's headers and policy. "Send again"
 * echoes once more with the same node, for example after the relay dropped.
 *
 * `?timeout=<milliseconds>` sets each step's deadline; it's 10 s by default.
 */
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

/** Where a check ended: "echoed", or what went wrong. */
type Outcome = "echoed" | "mismatch" | "no-server" | Problem;

function readTimeout(): number {
  const value = Number(new URLSearchParams(location.search).get("timeout"));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MILLISECONDS;
}

/** The server's node id, from the server itself (`/node`), or undefined when there's no server. */
async function findServer(): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(new URL("/node", location.origin), { cache: "no-store" });
  } catch {
    return undefined;
  }

  if (!response.ok) return undefined;

  const description: unknown = await response.json().catch(() => null);
  if (typeof description !== "object" || description === null || !("nodeId" in description)) {
    return undefined;
  }

  return typeof description.nodeId === "string" ? description.nodeId : undefined;
}

/** Reads the stream until the other side finishes. */
async function receiveAll(
  transport: Transport,
  stream: StreamHandle,
  timeout: number,
): Promise<{ text: string } | Problem> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    // One chunk after another, in order, until the node finishes.
    // oxlint-disable-next-line no-await-in-loop -- a stream's chunks arrive in order.
    const chunk = await transport.receive(stream, RECEIVE_LIMIT, timeout);
    if (chunk === null) return { text };

    if (typeof chunk === "string") return chunk;

    text += decoder.decode(chunk, { stream: true });
  }
}

/** Connects to the server's node, sends the message on a stream, and checks what comes back. */
async function echo(transport: Transport, serverId: string, timeout: number): Promise<Outcome> {
  const connection = await transport.connect(serverId, ECHO, timeout);
  if (typeof connection === "string") return connection;

  const stream = await transport.open(connection, timeout);
  if (typeof stream === "string") return stream;

  const sent = await transport.send(stream, new TextEncoder().encode(MESSAGE), timeout);
  if (sent !== "sent") return sent;

  const finished = await transport.finish(stream);
  if (finished !== "finished") return finished;

  const received = await receiveAll(transport, stream, timeout);
  void (await transport.disconnect(connection));
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
  const startedAt = performance.now();
  const timeout = readTimeout();
  const serverId = await findServer();
  if (serverId === undefined) {
    report("no-server", startedAt);
    return;
  }

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
