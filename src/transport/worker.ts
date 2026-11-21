/**
 * Runs the transport's WebAssembly module (crates/transport) in a worker of its own, beside the
 * database's (see Where it runs in crates/transport/README.md). The page that starts it sends a
 * port, and every call comes over that port (./call.ts).
 *
 * The module is fetched only on the first call, by its hash, so the browser refuses bytes that
 * aren't the ones the build made.
 */
import { bindings } from "virtual:transport";

import type { Result } from "../result.ts";
import type { Bindings, Connection, Node, Stream } from "./bindings.ts";
import type { Answers, Call, Problem, Request, Response } from "./call.ts";

let loading: Promise<Result<Bindings, "unavailable">> | undefined;
let node: Node | undefined;
const connections = new Map<number, Connection>();
const streams = new Map<number, Stream>();
let lastHandle = 0;

async function instantiate(loaded: Bindings): Promise<Result<Bindings, "unavailable">> {
  try {
    await loaded.initialize({
      module_or_path: fetch(loaded.url, { integrity: loaded.integrity }),
    });
  } catch (error) {
    console.warn("[transport] the module didn't load", error);
    return "unavailable";
  }

  return loaded;
}

function load(): Promise<Result<Bindings, "unavailable">> {
  if (bindings === undefined) return Promise.resolve("unavailable");

  loading ??= instantiate(bindings);
  return loading;
}

/** A failure the module threw, as its kind. Anything else is a mistake, and is thrown on. */
function readFailure(loaded: Bindings, error: unknown): Problem {
  if (!(error instanceof loaded.Failure)) throw error;

  console.debug("[transport]", error.kind, error.message);
  return error.kind;
}

/** Runs one call into the module, with its failure as a value. */
async function runStep<Value>(step: () => Value | Promise<Value>): Promise<Result<Value, Problem>> {
  const loaded = await load();
  if (loaded === "unavailable") return loaded;

  let value: Value;
  try {
    value = await step();
  } catch (error) {
    return readFailure(loaded, error);
  }

  return value;
}

function keep<Value>(handles: Map<number, Value>, value: Value): number {
  lastHandle += 1;
  handles.set(lastHandle, value);
  return lastHandle;
}

async function spawn(call: Extract<Call, { type: "spawn" }>): Promise<Answers["spawn"]> {
  const loaded = await load();
  if (loaded === "unavailable") return loaded;

  const spawned = await runStep(() =>
    loaded.Node.spawn(call.secretKey, call.relayUrl, call.timeout),
  );
  if (typeof spawned === "string") return spawned;

  node = spawned;
  return { nodeId: spawned.id };
}

async function connect(call: Extract<Call, { type: "connect" }>): Promise<Answers["connect"]> {
  const current = node;
  if (current === undefined) return "closed";

  const connection = await runStep(() => current.connect(call.nodeId, call.protocol, call.timeout));
  if (typeof connection === "string") return connection;

  return { connection: keep(connections, connection) };
}

async function open(call: Extract<Call, { type: "open" }>): Promise<Answers["open"]> {
  const connection = connections.get(call.connection);
  if (connection === undefined) return "closed";

  const stream = await runStep(() => connection.open(call.timeout));
  if (typeof stream === "string") return stream;

  return { stream: keep(streams, stream) };
}

async function send(call: Extract<Call, { type: "send" }>): Promise<Answers["send"]> {
  const stream = streams.get(call.stream);
  if (stream === undefined) return "closed";

  const sent = await runStep(() => stream.send(call.bytes, call.timeout));
  return sent ?? "sent";
}

async function finish(call: Extract<Call, { type: "finish" }>): Promise<Answers["finish"]> {
  const stream = streams.get(call.stream);
  if (stream === undefined) return "closed";

  const finished = await runStep(() => {
    stream.finish();
  });
  return finished ?? "finished";
}

async function receive(call: Extract<Call, { type: "receive" }>): Promise<Answers["receive"]> {
  const stream = streams.get(call.stream);
  if (stream === undefined) return "closed";

  const bytes = await runStep(() => stream.receive(call.limit, call.timeout));
  return bytes ?? null;
}

function disconnect(call: Extract<Call, { type: "disconnect" }>): Answers["disconnect"] {
  connections.get(call.connection)?.close();
  connections.get(call.connection)?.free();
  connections.delete(call.connection);
  return "disconnected";
}

async function stop(): Promise<Answers["stop"]> {
  for (const stream of streams.values()) stream.free();

  streams.clear();
  for (const connection of connections.values()) connection.free();

  connections.clear();
  await node?.close();
  node?.free();
  node = undefined;
  return "stopped";
}

// oxlint-disable-next-line typescript/consistent-return -- the switch names every call (switch-exhaustiveness-check), so the end is never reached.
function answer(call: Call): Promise<Answers[Call["type"]]> | Answers[Call["type"]] {
  switch (call.type) {
    case "spawn":
      return spawn(call);
    case "connect":
      return connect(call);
    case "open":
      return open(call);
    case "send":
      return send(call);
    case "finish":
      return finish(call);
    case "receive":
      return receive(call);
    case "disconnect":
      return disconnect(call);
    case "stop":
      return stop();
  }
}

async function respond(port: MessagePort, { id, call }: Request): Promise<void> {
  let result: Answers[Call["type"]];
  try {
    result = await answer(call);
  } catch (error) {
    console.error("[transport]", error);
    port.postMessage({ type: "error", id, message: String(error) } satisfies Response);
    return;
  }

  port.postMessage({ type: "answer", id, answer: result } satisfies Response);
}

function serve(port: MessagePort): void {
  port.addEventListener("message", (event: MessageEvent<Request>) => {
    // Answers its own errors: a mistake goes back to the page as an error.
    void respond(port, event.data);
  });
  port.start();
}

addEventListener(
  "message",
  (event: MessageEvent<unknown>) => {
    const [port] = event.ports;
    if (port !== undefined) serve(port);
  },
  { once: true },
);
