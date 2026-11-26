/**
 * The transport as the page uses it: an iroh node in a worker of its own (./worker.ts), whose
 * methods (./api.ts) the page reaches through the broadcast service over a MessagePort, each giving
 * back a `Result`. It says nothing about syncing: start a node, connect to another by its id through
 * the relay, and send and receive bytes on streams.
 *
 * Nothing here loads until `start()` runs, and nothing in the app calls it on a normal start (see
 * docs/LOADING.md). Every call that waits on the network has a deadline, and the page keeps one of
 * its own a little longer (./deadline.ts), so even a worker that stops answering ends in "timeout",
 * never a hang, and one that crashed in "unavailable".
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
import { waitWithin } from "./deadline.ts";

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
 * come back as handles that close with `await using`, and stopping also ends the worker.
 */
export type Transport = Omit<TransportApi, "connect" | "open" | "stop"> & {
  connect(nodeId: string, protocol: string, timeout: number): Promise<Result<Connection, Problem>>;
  open(connection: ConnectionHandle, timeout: number): Promise<Result<Stream, Problem>>;
  /** Stops the node, closing every connection, and ends the worker. */
  stop(): Promise<Answer<"stop">>;
};

/** Starts the worker. The module itself loads with the first call. */
export function start(): Transport {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "transport",
  });
  const { port1: port, port2 } = new MessageChannel();
  worker.postMessage(null, [port2]);
  // The consumer listens before the port starts delivering.
  const { proxy } = consumeSameVersion<TransportApi>(port, SCOPE);
  port.start();

  // A worker that fails to start or throws outside a call answers nothing again, so the port closes
  // and every call from then on is "unavailable" without being sent.
  let isWorkerStopped = false;
  const { promise: workerStopped, resolve: stopWorker } = Promise.withResolvers<"unavailable">();
  worker.addEventListener("error", (event) => {
    console.error("[transport] the worker stopped", event.message);
    isWorkerStopped = true;
    port.close();
    stopWorker("unavailable");
  });

  /**
   * Sends a call to the worker, unless it stopped, and waits for its answer within the page's
   * deadline.
   *
   * @param send - Sends the call: only run while the worker runs.
   * @param timeout - The call's own deadline, which the page's is a little longer than.
   */
  function callWorker<Value>(
    send: () => Promise<Value>,
    timeout: number,
  ): Promise<Value | "timeout" | "unavailable"> {
    if (isWorkerStopped) return Promise.resolve("unavailable");

    return waitWithin(send(), timeout + MARGIN_MILLISECONDS, workerStopped);
  }

  // Each call passes a handle's number in a new object: the page's handles carry their dispose
  // function, which a message can't carry.
  const release = (stream: StreamHandle): Promise<Answer<"release">> =>
    callWorker(() => proxy.release({ stream: stream.stream }), LOCAL_TIMEOUT_MILLISECONDS);
  const disconnect = (connection: ConnectionHandle): Promise<Answer<"disconnect">> =>
    callWorker(
      () => proxy.disconnect({ connection: connection.connection }),
      LOCAL_TIMEOUT_MILLISECONDS,
    );

  return {
    spawn: (secretKey, relayUrl, timeout) =>
      callWorker(() => proxy.spawn(secretKey, relayUrl, timeout), timeout),
    async connect(nodeId, protocol, timeout) {
      const connected = await callWorker(() => proxy.connect(nodeId, protocol, timeout), timeout);
      if (typeof connected === "string") return connected;

      return {
        connection: connected.connection,
        // A dispose can't give back a Result, so a problem there is dropped; a mistake in the
        // worker still rejects it.
        [Symbol.asyncDispose]: async () => void (await disconnect(connected)),
      };
    },
    async open(connection, timeout) {
      const opened = await callWorker(
        () => proxy.open({ connection: connection.connection }, timeout),
        timeout,
      );
      if (typeof opened === "string") return opened;

      return {
        stream: opened.stream,
        [Symbol.asyncDispose]: async () => void (await release(opened)),
      };
    },
    send: (stream, bytes, timeout) =>
      callWorker(() => proxy.send({ stream: stream.stream }, bytes, timeout), timeout),
    finish: (stream) =>
      callWorker(() => proxy.finish({ stream: stream.stream }), LOCAL_TIMEOUT_MILLISECONDS),
    receive: (stream, limit, timeout) =>
      callWorker(() => proxy.receive({ stream: stream.stream }, limit, timeout), timeout),
    release,
    disconnect,
    async stop() {
      const stopped = await callWorker(() => proxy.stop(), LOCAL_TIMEOUT_MILLISECONDS);
      worker.terminate();
      port.close();
      return stopped;
    },
  };
}
