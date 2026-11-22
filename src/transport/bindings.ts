/**
 * The part of the transport's WebAssembly module (crates/transport) the worker uses, as
 * `virtual:transport` gives it (vite-plugins/transport.ts). wasm-bindgen writes types of its own,
 * but only a build with Rust has them, and the app's checks run without Rust, so these describe the
 * same API by hand. The browser test for the transport runs the real module against them.
 */

/** What kind of failure: `Kind` in crates/transport/src/failure.rs. */
export type FailureKind = "timeout" | "unreachable" | "closed" | "invalid";

/** What the module throws when a call fails: `Failure` in crates/transport/src/failure.rs. */
interface Failure {
  readonly type: FailureKind;
  /** For the console, not for people. */
  readonly message: string;
}

/** Every method's `timeout` is a deadline in milliseconds. */
export interface Stream {
  send(bytes: Uint8Array, timeout: number): Promise<void>;
  finish(): void;
  /** The next bytes, at most `limit`, or undefined once the other side finished. */
  receive(limit: number, timeout: number): Promise<Uint8Array | undefined>;
  /** Releases the stream's memory in the module. */
  free(): void;
}

export interface Connection {
  open(timeout: number): Promise<Stream>;
  close(): void;
  free(): void;
}

export interface Node {
  readonly id: string;
  connect(nodeId: string, protocol: string, timeout: number): Promise<Connection>;
  close(): Promise<void>;
  free(): void;
}

export type Bindings = {
  /** The module's URL, with a hash of its content in its name. */
  url: string;
  /** The module's SHA-384, for `fetch` with `integrity`. */
  integrity: string;
  /** Instantiates the module from a response: wasm-bindgen's default export. */
  initialize(options: { module_or_path: Promise<Response> }): Promise<unknown>;
  Failure: abstract new (...parameters: never[]) => Failure;
  Node: {
    spawn(secretKey: Uint8Array, relayUrl: string, timeout: number): Promise<Node>;
  };
};
