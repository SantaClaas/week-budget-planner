/**
 * Runs the transport's WebAssembly module (crates/transport) in a worker of its own, beside the
 * database's (see Where it runs in crates/transport/README.md). The page that starts it sends a
 * port, and the worker provides its methods (./api.ts) over it through the broadcast service.
 *
 * The module is fetched only on the first call, by its hash, so the browser refuses bytes that
 * aren't the ones the build made.
 */
import { bindings } from "virtual:transport";

import { provide } from "../broadcast/service.ts";
import type { Result } from "../result.ts";
import { SCOPE, type Problem, type TransportApi } from "./api.ts";
import type { Bindings, Connection, Node, Stream } from "./bindings.ts";

let loading: Promise<Result<Bindings, "unavailable">> | undefined;
let node: Node | undefined;
const connections = new Map<number, Connection>();
/** Each stream, with the connection it's on, so disconnecting releases it too. */
const streams = new Map<number, { stream: Stream; connection: number }>();
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

/** A failure the module threw, as its type. Anything else is a mistake, and is thrown on. */
function readFailure(loaded: Bindings, error: unknown): Problem {
  if (!(error instanceof loaded.Failure)) throw error;

  console.debug("[transport]", error.type, error.message);
  return error.type;
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

const spawn: TransportApi["spawn"] = async (secretKey, relayUrl, timeout) => {
  const loaded = await load();
  if (loaded === "unavailable") return loaded;

  const spawned = await runStep(() => loaded.Node.spawn(secretKey, relayUrl, timeout));
  if (typeof spawned === "string") return spawned;

  node = spawned;
  return { nodeId: spawned.id };
};

const connect: TransportApi["connect"] = async (nodeId, protocol, timeout) => {
  const current = node;
  if (current === undefined) return "closed";

  const connection = await runStep(() => current.connect(nodeId, protocol, timeout));
  if (typeof connection === "string") return connection;

  return { connection: keep(connections, connection) };
};

const open: TransportApi["open"] = async ({ connection: handle }, timeout) => {
  const connection = connections.get(handle);
  if (connection === undefined) return "closed";

  const stream = await runStep(() => connection.open(timeout));
  if (typeof stream === "string") return stream;

  return { stream: keep(streams, { stream, connection: handle }) };
};

const send: TransportApi["send"] = async ({ stream: handle }, bytes, timeout) => {
  const stream = streams.get(handle)?.stream;
  if (stream === undefined) return "closed";

  const sent = await runStep(() => stream.send(bytes, timeout));
  return sent ?? "sent";
};

const finish: TransportApi["finish"] = async ({ stream: handle }) => {
  const stream = streams.get(handle)?.stream;
  if (stream === undefined) return "closed";

  const finished = await runStep(() => {
    stream.finish();
  });
  return finished ?? "finished";
};

const receive: TransportApi["receive"] = async ({ stream: handle }, limit, timeout) => {
  const stream = streams.get(handle)?.stream;
  if (stream === undefined) return "closed";

  const bytes = await runStep(() => stream.receive(limit, timeout));
  return bytes ?? null;
};

/**
 * Frees a stream in the module. Dropping it there finishes what it sends, so what was sent is still
 * delivered, and tells the other side to stop sending.
 */
function freeStream(handle: number): void {
  streams.get(handle)?.stream.free();
  streams.delete(handle);
}

const release: TransportApi["release"] = ({ stream: handle }) => {
  freeStream(handle);
  return Promise.resolve("released");
};

const disconnect: TransportApi["disconnect"] = ({ connection: handle }) => {
  for (const [stream, { connection }] of streams) {
    if (connection === handle) freeStream(stream);
  }

  connections.get(handle)?.close();
  connections.get(handle)?.free();
  connections.delete(handle);
  return Promise.resolve("disconnected");
};

const stop: TransportApi["stop"] = async () => {
  for (const { stream } of streams.values()) stream.free();

  streams.clear();
  for (const connection of connections.values()) connection.free();

  connections.clear();
  await node?.close();
  node?.free();
  node = undefined;
  return "stopped";
};

const api: TransportApi = {
  spawn,
  connect,
  open,
  send,
  finish,
  receive,
  release,
  disconnect,
  stop,
};

addEventListener(
  "message",
  (event: MessageEvent<unknown>) => {
    const [port] = event.ports;
    if (port === undefined) return;

    // It serves for as long as the worker runs, so the function that stops serving isn't needed. It
    // listens before the port starts delivering.
    void provide(port, SCOPE, api);
    port.start();
  },
  { once: true },
);
