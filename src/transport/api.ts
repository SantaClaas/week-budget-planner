/**
 * What the transport's worker serves the page: an object of async methods, each giving back a
 * `Result`, which the worker provides and the page consumes through the broadcast service over a
 * MessagePort (src/broadcast/service.ts). Both sides are this app's code from one build, so no
 * method needs to answer "newer-version" (`consumeSameVersion`).
 */
import type { Result } from "../result.ts";
import type { FailureType } from "./bindings.ts";

/** The scope the worker serves under on its port. */
export const SCOPE = "transport";

/**
 * What can go wrong: the module's own failures, or "unavailable" when there is no module to run (the
 * build had none, or it didn't load, or its bytes didn't match its hash), or no worker.
 */
export type Problem = FailureType | "unavailable";

/** A connection the worker holds, by its number there. */
export type ConnectionHandle = { readonly connection: number };
/** A stream the worker holds, by its number there. */
export type StreamHandle = { readonly stream: number };

/** Every `timeout` is a deadline in milliseconds. */
export type TransportApi = {
  /** Loads the module on the first call, starts this browser's node, and waits for the relay. */
  spawn(
    secretKey: Uint8Array,
    relayUrl: string,
    timeout: number,
  ): Promise<Result<{ nodeId: string }, Problem>>;
  connect(
    nodeId: string,
    protocol: string,
    timeout: number,
  ): Promise<Result<ConnectionHandle, Problem>>;
  open(connection: ConnectionHandle, timeout: number): Promise<Result<StreamHandle, Problem>>;
  send(stream: StreamHandle, bytes: Uint8Array, timeout: number): Promise<Result<"sent", Problem>>;
  finish(stream: StreamHandle): Promise<Result<"finished", Problem>>;
  /** The next bytes, at most `limit`, or null once the other side finished. */
  receive(
    stream: StreamHandle,
    limit: number,
    timeout: number,
  ): Promise<Result<Uint8Array | null, Problem>>;
  /**
   * Frees the stream: what was sent is still delivered, and the other side is told to stop
   * sending.
   */
  release(stream: StreamHandle): Promise<Result<"released", Problem>>;
  /** Releases the connection's streams, then closes and frees the connection. */
  disconnect(connection: ConnectionHandle): Promise<Result<"disconnected", Problem>>;
  /** Frees every stream and connection, and stops the node. */
  stop(): Promise<Result<"stopped", Problem>>;
};
