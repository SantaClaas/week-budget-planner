/**
 * The calls between the page and the transport's worker, and what each answers. Both sides are this
 * app's code from the same build, so the messages carry no version.
 */
import type { Result } from "../result.ts";
import type { FailureType } from "./bindings.ts";

/**
 * What can go wrong: the module's own failures, or "unavailable" when there is no module to run (the
 * build had none, or it didn't load, or its bytes didn't match its hash).
 */
export type Problem = FailureType | "unavailable";

/** A connection the worker holds, by its number there. */
export type ConnectionHandle = { readonly connection: number };
/** A stream the worker holds, by its number there. */
export type StreamHandle = { readonly stream: number };

/** Every call, without its id. Each `timeout` is a deadline in milliseconds. */
export type Call =
  | { type: "spawn"; secretKey: Uint8Array; relayUrl: string; timeout: number }
  | { type: "connect"; nodeId: string; protocol: string; timeout: number }
  | ({ type: "open"; timeout: number } & ConnectionHandle)
  | ({ type: "send"; bytes: Uint8Array; timeout: number } & StreamHandle)
  | ({ type: "finish" } & StreamHandle)
  | ({ type: "receive"; limit: number; timeout: number } & StreamHandle)
  | ({ type: "release" } & StreamHandle)
  | ({ type: "disconnect" } & ConnectionHandle)
  | { type: "stop" };

/** What each call answers. */
export type Answers = {
  spawn: Result<{ nodeId: string }, Problem>;
  connect: Result<ConnectionHandle, Problem>;
  open: Result<StreamHandle, Problem>;
  send: Result<"sent", Problem>;
  finish: Result<"finished", Problem>;
  /** The next bytes, or null once the other side finished. */
  receive: Result<Uint8Array | null, Problem>;
  release: Result<"released", Problem>;
  disconnect: Result<"disconnected", Problem>;
  stop: Result<"stopped", Problem>;
};

/** A call as it's posted to the worker. */
export type Request = { id: number; call: Call };

/** What the worker posts back: the answer to the call with the same id, or the error it threw. */
export type Response =
  | { type: "answer"; id: number; answer: Answers[Call["type"]] }
  | { type: "error"; id: number; message: string };
