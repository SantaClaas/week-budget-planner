/**
 * The transport as the page uses it: an iroh node in a worker of its own (./worker.ts), whose
 * methods (./api.ts) the page reaches through the broadcast service over a MessagePort, each giving
 * back a `Result`. It says nothing about syncing: start a node, connect to another by its id through
 * the relay, and send and receive bytes on streams.
 *
 * Nothing here loads until `start()` runs, and nothing in the app calls it on a normal start (see
 * docs/LOADING.md). Every call that waits on the network has a deadline, and the page keeps one of
 * its own a little longer, so even a worker that stops answering ends in "timeout", never a hang.
 */
import { consumeSameVersion } from "../broadcast/service.ts";
import type { Result } from "../result.ts";
import {
  SCOPE,
  type ConnectionHandle,
  type Problem,
  type StreamHandle,
  type TransportApi,
} from "./api.ts";

/** How much longer the page waits than the worker's own deadline before it gives up. */
const MARGIN_MILLISECONDS = 1000;
/** The deadline of a call that doesn't wait on the network. */
const LOCAL_TIMEOUT_MILLISECONDS = 5000;

export type { ConnectionHandle, Problem, StreamHandle };

/** A connection the worker holds. Disposing it disconnects, so `await using` closes it. */
type Connection = ConnectionHandle & AsyncDisposable;
/** A stream the worker holds. Disposing it releases it, so `await using` closes it. */
type Stream = StreamHandle & AsyncDisposable;

/** What a method of the worker's gives back. */
type Answer<Name extends keyof TransportApi> = Awaited<ReturnType<TransportApi[Name]>>;

/**
 * The worker's methods as the page calls them: the same as ./api.ts, but a connection and a stream
 * come back as handles that close with `await using`.
 */
export type Transport = Omit<TransportApi, "connect" | "open"> & {
  connect(nodeId: string, protocol: string, timeout: number): Promise<Result<Connection, Problem>>;
  open(connection: ConnectionHandle, timeout: number): Promise<Result<Stream, Problem>>;
};

/** Starts the worker. The module itself loads with the first call. */
export function start(): Transport {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "transport",
  });
  const { port1: port, port2 } = new MessageChannel();
  worker.postMessage(null, [port2]);
  port.start();
  const { proxy } = consumeSameVersion<TransportApi>(port, SCOPE);

  // A worker that fails to start or throws outside a call answers nothing again.
  const { promise: workerStopped, resolve: stopWorker } = Promise.withResolvers<"unavailable">();
  worker.addEventListener("error", (event) => {
    console.error("[transport] the worker stopped", event.message);
    stopWorker("unavailable");
  });

  /** The worker's answer, or "timeout" a little after the call's own deadline, or "unavailable". */
  async function waitWithin<Value>(
    call: Promise<Value>,
    timeout: number,
  ): Promise<Value | "timeout" | "unavailable"> {
    const { promise: late, resolve } = Promise.withResolvers<"timeout">();
    const timer = setTimeout(() => {
      resolve("timeout");
    }, timeout + MARGIN_MILLISECONDS);
    const answer = await Promise.race([call, late, workerStopped]);
    clearTimeout(timer);
    return answer;
  }

  // Each call passes a handle's number in a new object: the page's handles carry their dispose
  // function, which a message can't carry.
  const release = (stream: StreamHandle): Promise<Answer<"release">> =>
    waitWithin(proxy.release({ stream: stream.stream }), LOCAL_TIMEOUT_MILLISECONDS);
  const disconnect = (connection: ConnectionHandle): Promise<Answer<"disconnect">> =>
    waitWithin(proxy.disconnect({ connection: connection.connection }), LOCAL_TIMEOUT_MILLISECONDS);

  return {
    spawn: (secretKey, relayUrl, timeout) =>
      waitWithin(proxy.spawn(secretKey, relayUrl, timeout), timeout),
    async connect(nodeId, protocol, timeout) {
      const connected = await waitWithin(proxy.connect(nodeId, protocol, timeout), timeout);
      if (typeof connected === "string") return connected;

      return {
        connection: connected.connection,
        // A dispose can't give back a Result; a problem there is in the worker's console.
        [Symbol.asyncDispose]: async () => void (await disconnect(connected)),
      };
    },
    async open(connection, timeout) {
      const opened = await waitWithin(
        proxy.open({ connection: connection.connection }, timeout),
        timeout,
      );
      if (typeof opened === "string") return opened;

      return {
        stream: opened.stream,
        [Symbol.asyncDispose]: async () => void (await release(opened)),
      };
    },
    send: (stream, bytes, timeout) =>
      waitWithin(proxy.send({ stream: stream.stream }, bytes, timeout), timeout),
    finish: (stream) =>
      waitWithin(proxy.finish({ stream: stream.stream }), LOCAL_TIMEOUT_MILLISECONDS),
    receive: (stream, limit, timeout) =>
      waitWithin(proxy.receive({ stream: stream.stream }, limit, timeout), timeout),
    release,
    disconnect,
    async stop() {
      const stopped = await waitWithin(proxy.stop(), LOCAL_TIMEOUT_MILLISECONDS);
      worker.terminate();
      port.close();
      return stopped;
    },
  };
}
