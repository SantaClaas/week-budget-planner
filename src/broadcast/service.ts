// Adapted from SantaClaas/flashcut (src/lib/broadcast-service.ts).
/**
 * Comlink-style RPC between same-origin tabs, in the spirit of crackle, but over a
 * BroadcastChannel: exactly one tab (the provider, elected elsewhere via the Web Locks API) serves
 * calls from every other tab.
 *
 * Unlike a MessagePort proxy, a BroadcastChannel cannot transfer ports, so each call is correlated
 * with its response by a random id on the shared channel. Consumers discover the provider through a
 * query/ready handshake; the provider announces itself with a random providerId so consumers can
 * tell a leadership change apart from a plain "still here" reply.
 */

import { PROTOCOL_VERSION } from "./protocol/index.ts";

/** Every exposed method must be async — the channel makes everything async anyway. */
type AsyncApi = Record<string, (...parameters: never[]) => Promise<unknown>>;

/** Every message on the channel. Changing it can break older tabs (see ./protocol/index.ts). */
export type ServiceMessage = { protocolVersion: number; scope: string } & (
  | { type: "call"; id: string; property: string; parameters: unknown[] }
  | { type: "result"; id: string; result: unknown }
  | { type: "error"; id: string; error: unknown; name?: string }
  | { type: "provider-ready"; providerId: string }
  | { type: "provider-query" }
  // Every tab reloads, after the database file was replaced or deleted.
  | { type: "reload" }
);

/**
 * The call had not been sent yet when this tab was promoted to provider — it was never delivered
 * anywhere, so callers may safely retry.
 */
export class ProviderChangedError extends Error {}

/**
 * The provider changed or went silent while the call was in flight. The old provider may or may
 * not have applied it, so it is NOT retried automatically.
 */
class CallLostError extends Error {}

/** No provider answered within the time limit. The call was never sent. */
export class ProviderMissingError extends Error {}

/**
 * Another tab runs a newer version of the protocol, so this tab is outdated: its open calls are
 * refused, since the provider they'd need can't be trusted to read them.
 */
export class NewerProtocolError extends Error {}

/** What a side does once it hears from a tab on a newer version of the protocol. */
type Options = { readonly onNewerVersion?: () => void };

const doNothing = (): void => {};

/** A call that reached the provider but failed there. `cause` holds the provider-side error. */
export class RemoteCallError extends Error {}

/** The provider's error as a RemoteCallError, with the name that structured cloning dropped. */
function readRemoteError(error: unknown, name: string | undefined): RemoteCallError {
  if (error instanceof Error && name !== undefined) error.name = name;
  return new RemoteCallError("The leader tab failed to execute the call.", { cause: error });
}

/**
 * Serve `target`'s methods to all consumer tabs on the channel.
 * @mustUse Gives back the function that stops serving, for when this tab steps down.
 */
export function provide(
  channel: BroadcastChannel,
  scope: string,
  target: AsyncApi,
  { onNewerVersion = doNothing }: Options = {},
): () => void {
  const providerId = crypto.randomUUID();
  const ready: ServiceMessage = {
    protocolVersion: PROTOCOL_VERSION,
    scope,
    type: "provider-ready",
    providerId,
  };

  const listener = (event: MessageEvent<ServiceMessage>): void => {
    const message = event.data;
    if (message.scope !== scope) return;
    // Every version keeps `protocolVersion` and `scope` in its envelope, so any tab can read them.
    if (message.protocolVersion > PROTOCOL_VERSION) {
      onNewerVersion();
      return;
    }
    if (message.protocolVersion < PROTOCOL_VERSION) {
      // An older tab can't read anything else from this one, but this version tells it it's outdated.
      channel.postMessage(ready);
      return;
    }
    switch (message.type) {
      case "provider-query":
        channel.postMessage(ready);
        break;
      case "call":
        // answer posts every outcome itself, failures included, so nothing is left to handle here.
        void answer(message);
        break;
      case "provider-ready":
      case "result":
      case "error":
        // Messages for consumers.
        break;
      case "reload":
        // Every tab's owner handles it (see src/database/client.ts).
        break;
    }
  };
  channel.addEventListener("message", listener);

  /** Runs the call and posts its result or its error to the consumer that's waiting. */
  async function answer(call: { id: string; property: string; parameters: unknown[] }) {
    const method = target[call.property];
    if (typeof method !== "function") {
      postError(call.id, new TypeError(`Unknown service method: ${call.property}`));
      return;
    }
    let result: unknown;
    try {
      result = await Reflect.apply(method, target, call.parameters);
    } catch (error) {
      postError(call.id, error);
      return;
    }
    try {
      channel.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        scope,
        type: "result",
        id: call.id,
        result,
      } satisfies ServiceMessage);
    } catch (error) {
      // The result isn't structured-cloneable, so the consumer hears that instead.
      postError(call.id, error);
    }
  }

  function postError(id: string, error: unknown): void {
    try {
      // Structured cloning turns custom errors into a plain Error, so the name travels apart.
      channel.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        scope,
        type: "error",
        id,
        error,
        ...(error instanceof Error && { name: error.name }),
      } satisfies ServiceMessage);
    } catch {
      // The error isn't structured-cloneable; send its string form.
      channel.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        scope,
        type: "error",
        id,
        error: String(error),
      } satisfies ServiceMessage);
    }
  }

  channel.postMessage(ready);
  return () => {
    channel.removeEventListener("message", listener);
  };
}

export interface Consumer<T> {
  proxy: T;
  /**
   * Call when this tab itself becomes the provider: calls still waiting for a provider are rejected
   * with ProviderChangedError (retryable), calls already sent to the previous provider with
   * CallLostError.
   */
  handlePromotion(): void;
}

interface PendingCall {
  resolve(value?: unknown): void;
  reject(reason: unknown): void;
}

const PROVIDER_QUERY_INTERVAL_MILLISECONDS = 500;

/**
 * How long a consumer waits without any sign of life from the provider. While calls are open it
 * asks every half second, and a provider answers even while it's busy, so only a provider that
 * stopped running (for example a frozen background tab) runs into this.
 */
const SILENCE_LIMIT_MILLISECONDS = 10_000;

/** A proxy whose method calls are served by whichever tab currently provides `scope`. */
export function consume<T extends AsyncApi>(
  channel: BroadcastChannel,
  scope: string,
  { onNewerVersion = doNothing }: Options = {},
): Consumer<T> {
  const sent = new Map<string, PendingCall>();
  let providerId: string | undefined;
  let readyWaiters: PendingCall[] = [];
  let queryTimer: ReturnType<typeof setInterval> | undefined;
  let lastHeardAt = 0;

  const query = (): void => {
    channel.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      scope,
      type: "provider-query",
    } satisfies ServiceMessage);
  };

  function failSent(reason: Error) {
    const calls = [...sent.values()];
    sent.clear();
    for (const call of calls) call.reject(reason);
  }

  function settleWaiters(settle: (waiter: PendingCall) => void) {
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const waiter of waiters) settle(waiter);
  }

  function stopQueryingWhenIdle() {
    if (queryTimer === undefined || readyWaiters.length > 0 || sent.size > 0) return;
    clearInterval(queryTimer);
    queryTimer = undefined;
  }

  /** Asks for the provider every half second while anything waits, and gives up after silence. */
  function startQuerying() {
    if (queryTimer !== undefined) return;
    lastHeardAt = performance.now();
    query();
    queryTimer = setInterval(() => {
      if (performance.now() - lastHeardAt <= SILENCE_LIMIT_MILLISECONDS) {
        query();
        return;
      }
      // Forget the silent provider, so the next call looks for one again.
      providerId = undefined;
      settleWaiters((waiter) => {
        waiter.reject(new ProviderMissingError("No database leader tab answered."));
      });
      failSent(new CallLostError("The database leader tab stopped answering."));
      stopQueryingWhenIdle();
    }, PROVIDER_QUERY_INTERVAL_MILLISECONDS);
  }

  channel.addEventListener("message", (event: MessageEvent<ServiceMessage>) => {
    const message = event.data;
    if (message.scope !== scope) return;
    // Every version keeps `protocolVersion` and `scope` in its envelope, so any tab can read them.
    if (message.protocolVersion > PROTOCOL_VERSION) {
      giveWayToNewerVersion();
      return;
    }
    if (message.protocolVersion < PROTOCOL_VERSION) return;
    switch (message.type) {
      case "provider-ready":
        acceptProvider(message.providerId);
        break;
      case "result":
        takeCall(message.id)?.resolve(message.result);
        break;
      case "error":
        takeCall(message.id)?.reject(readRemoteError(message.error, message.name));
        break;
      case "call":
      case "provider-query":
        // Messages for the provider.
        break;
      case "reload":
        // Every tab's owner handles it (see src/database/client.ts).
        break;
    }
  });

  /** Refuses every open call, since a tab on a newer protocol runs, and says so. */
  function giveWayToNewerVersion() {
    const error = new NewerProtocolError("A newer version of the app runs in another tab.");
    providerId = undefined;
    settleWaiters((waiter) => {
      waiter.reject(error);
    });
    failSent(error);
    stopQueryingWhenIdle();
    onNewerVersion();
  }

  /** Follows the provider that announced itself; calls sent to a different one are lost. */
  function acceptProvider(announcedId: string) {
    if (providerId !== undefined && providerId !== announcedId) {
      failSent(new CallLostError("The database leader changed while a call was in flight."));
    }
    providerId = announcedId;
    lastHeardAt = performance.now();
    settleWaiters((waiter) => {
      waiter.resolve();
    });
    stopQueryingWhenIdle();
  }

  /** The call this answer is for, no longer open, or undefined when it's another tab's. */
  function takeCall(id: string): PendingCall | undefined {
    const call = sent.get(id);
    if (!call) return undefined;
    lastHeardAt = performance.now();
    sent.delete(id);
    stopQueryingWhenIdle();
    return call;
  }

  function waitForProvider(): Promise<void> {
    if (providerId !== undefined) return Promise.resolve();
    return new Promise((resolve, reject) => {
      readyWaiters.push({
        resolve: () => {
          resolve();
        },
        reject,
      });
      startQuerying();
    });
  }

  const handler: ProxyHandler<object> = {
    get(target, property) {
      // Awaiting the proxy itself must not treat it as a thenable (see crackle), so `then` and
      // symbols read the empty target's own (missing) property.
      if (property === "then" || typeof property !== "string") {
        const own: unknown = Reflect.get(target, property);
        return own;
      }
      return async (...parameters: unknown[]) => {
        await waitForProvider();
        const id = crypto.randomUUID();
        const response = new Promise((resolve, reject) => {
          sent.set(id, { resolve, reject });
        });
        startQuerying();
        channel.postMessage({
          protocolVersion: PROTOCOL_VERSION,
          scope,
          type: "call",
          id,
          property,
          parameters,
        } satisfies ServiceMessage);
        return response;
      };
    },
  };

  return {
    // The proxy answers every method name, so it stands in for whatever T the caller asks for.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- a Proxy answers any method name, which TypeScript can't see.
    proxy: new Proxy({}, handler) as T,
    handlePromotion() {
      settleWaiters((waiter) => {
        waiter.reject(new ProviderChangedError("This tab became the provider."));
      });
      failSent(
        new CallLostError("This tab became the database leader while a call was in flight."),
      );
      stopQueryingWhenIdle();
    },
  };
}
