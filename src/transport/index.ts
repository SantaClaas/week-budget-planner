/**
 * The transport as the page uses it: an iroh node in a worker of its own (./worker.ts), reached
 * through calls that each give back a `Result`. It says nothing about syncing: start a node, connect
 * to another by its id through the relay, and send and receive bytes on streams.
 *
 * Nothing here loads until `start()` runs, and nothing in the app calls it on a normal start (see
 * docs/LOADING.md). Every call that waits on the network has a deadline, and the page keeps one of
 * its own a little longer, so even a worker that stops answering ends in "timeout", never a hang.
 */
import type { Result } from "../result.ts";
import type {
  Answers,
  Call,
  ConnectionHandle,
  Problem,
  Request,
  Response,
  StreamHandle,
} from "./call.ts";

/** How much longer the page waits than the worker's own deadline before it gives up. */
const MARGIN_MILLISECONDS = 1000;
/** The deadline of a call that doesn't wait on the network. */
const LOCAL_TIMEOUT_MILLISECONDS = 5000;

export type { ConnectionHandle, Problem, StreamHandle };

/** A connection the worker holds. Disposing it disconnects, so `await using` closes it. */
type Connection = ConnectionHandle & AsyncDisposable;
/** A stream the worker holds. Disposing it releases it, so `await using` closes it. */
type Stream = StreamHandle & AsyncDisposable;

export type Transport = {
  /**
   * Starts this browser's node and waits until it has reached the relay.
   *
   * @param secretKey - The node's 32 secret bytes, which make its id.
   * @param relayUrl - The relay's origin: the node connects to `/relay` and measures `/ping` there.
   * @param timeout - The deadline in milliseconds.
   * @returns The node's id.
   */
  spawn(
    secretKey: Uint8Array,
    relayUrl: string,
    timeout: number,
  ): Promise<Result<{ nodeId: string }, Problem>>;
  connect(nodeId: string, protocol: string, timeout: number): Promise<Result<Connection, Problem>>;
  open(connection: ConnectionHandle, timeout: number): Promise<Result<Stream, Problem>>;
  send(stream: StreamHandle, bytes: Uint8Array, timeout: number): Promise<Answers["send"]>;
  finish(stream: StreamHandle): Promise<Answers["finish"]>;
  /** @returns The next bytes, at most `limit`, or null once the other side finished. */
  receive(stream: StreamHandle, limit: number, timeout: number): Promise<Answers["receive"]>;
  /**
   * Frees the stream in the worker: what was sent is still delivered, and the other side is told to
   * stop sending. Disposing the stream does it.
   */
  release(stream: StreamHandle): Promise<Answers["release"]>;
  /** Closes the connection and releases its streams. Disposing the connection does it. */
  disconnect(connection: ConnectionHandle): Promise<Answers["disconnect"]>;
  /** Stops the node, closing every connection, and ends the worker. */
  stop(): Promise<Answers["stop"]>;
};

/** Starts the worker. The module itself loads with the first call. */
export function start(): Transport {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "transport",
  });
  const channel = new MessageChannel();
  worker.postMessage(null, [channel.port2]);
  const waiting = new Map<number, (response: Response | "timeout" | "unavailable") => void>();
  let lastId = 0;

  channel.port1.addEventListener("message", (event: MessageEvent<Response>) => {
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);
  });
  channel.port1.start();
  // A worker that fails to start or throws outside a call answers nothing again.
  worker.addEventListener("error", (event) => {
    console.error("[transport] the worker stopped", event.message);
    for (const settle of waiting.values()) settle("unavailable");

    waiting.clear();
  });

  function request<Type extends Call["type"]>(
    call: Extract<Call, { type: Type }>,
    timeout: number,
  ): Promise<Answers[Type]> {
    lastId += 1;
    const id = lastId;
    const { promise, resolve, reject } = Promise.withResolvers<Answers[Type]>();
    const timer = setTimeout(() => {
      waiting.get(id)?.("timeout");
      waiting.delete(id);
    }, timeout + MARGIN_MILLISECONDS);
    waiting.set(id, (response) => {
      clearTimeout(timer);
      if (response === "timeout" || response === "unavailable") {
        resolve(response);
        return;
      }

      if (response.type === "error") {
        reject(new Error(`the transport's worker failed: ${response.message}`));
        return;
      }

      // oxlint-disable-next-line typescript/consistent-type-assertions -- the worker answers a call with the answer for its type (./worker.ts, the same build), which a message can't carry in its type.
      resolve(response.answer as Answers[Type]);
    });
    channel.port1.postMessage({ id, call } satisfies Request);
    return promise;
  }

  // Each call names its fields: a handle the page holds carries its dispose function, which object
  // spread would copy and a message can't carry.
  const release = (stream: StreamHandle): Promise<Answers["release"]> =>
    request({ type: "release", stream: stream.stream }, LOCAL_TIMEOUT_MILLISECONDS);
  const disconnect = (connection: ConnectionHandle): Promise<Answers["disconnect"]> =>
    request({ type: "disconnect", connection: connection.connection }, LOCAL_TIMEOUT_MILLISECONDS);

  return {
    spawn: (secretKey, relayUrl, timeout) =>
      request({ type: "spawn", secretKey, relayUrl, timeout }, timeout),
    async connect(nodeId, protocol, timeout) {
      const connected = await request({ type: "connect", nodeId, protocol, timeout }, timeout);
      if (typeof connected === "string") return connected;

      return {
        connection: connected.connection,
        // A dispose can't give back a Result; a problem there is in the worker's console.
        [Symbol.asyncDispose]: async () => void (await disconnect(connected)),
      };
    },
    async open(connection, timeout) {
      const opened = await request(
        { type: "open", connection: connection.connection, timeout },
        timeout,
      );
      if (typeof opened === "string") return opened;

      return {
        stream: opened.stream,
        [Symbol.asyncDispose]: async () => void (await release(opened)),
      };
    },
    send: (stream, bytes, timeout) =>
      request({ type: "send", stream: stream.stream, bytes, timeout }, timeout),
    finish: (stream) =>
      request({ type: "finish", stream: stream.stream }, LOCAL_TIMEOUT_MILLISECONDS),
    receive: (stream, limit, timeout) =>
      request({ type: "receive", stream: stream.stream, limit, timeout }, timeout),
    release,
    disconnect,
    async stop() {
      const stopped = await request({ type: "stop" }, LOCAL_TIMEOUT_MILLISECONDS);
      worker.terminate();
      return stopped;
    },
  };
}
