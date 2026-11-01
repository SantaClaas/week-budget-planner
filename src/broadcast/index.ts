// Adapted from SantaClaas/flashcut (src/lib/broadcast.ts), without the Solid dependency. The
// leader election's calls go through ./service.ts on a channel of their own.
import { PROTOCOL_VERSION } from "./protocol/index.ts";

const BROADCAST_NAME = "week-budget-planner";

/**
 * App-level change events so other tabs reload the plan. The posting tab updates itself directly
 * (a BroadcastChannel does not deliver messages back to the poster).
 */
export type BroadcastMessage = { protocolVersion: number; type: "plan-changed" };

// One channel for sending and receiving: a BroadcastChannel doesn't deliver a message to the
// object that posted it, but does to every other object of the same name, in this tab too. With two,
// a tab would hear its own changes as another tab's.
let channel: BroadcastChannel | undefined;

function openChannel(): BroadcastChannel {
  channel ??= new BroadcastChannel(BROADCAST_NAME);
  return channel;
}

export function broadcastMessage(message: Omit<BroadcastMessage, "protocolVersion">): void {
  if (typeof BroadcastChannel === "undefined") return;
  openChannel().postMessage({
    protocolVersion: PROTOCOL_VERSION,
    ...message,
  } satisfies BroadcastMessage);
}

const doNothing = (): void => {};

/** Listens for change events from other tabs. Returns a function that stops listening. */
export function listenForBroadcasts(callback: (message: BroadcastMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return doNothing;
  const onMessage = (event: MessageEvent<BroadcastMessage>): void => {
    // A tab never interprets a message of another version (see ./protocol/index.ts).
    if (event.data.protocolVersion !== PROTOCOL_VERSION) return;
    callback(event.data);
  };
  const receiver = openChannel();
  receiver.addEventListener("message", onMessage);
  return () => {
    receiver.removeEventListener("message", onMessage);
  };
}
