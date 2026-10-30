// Adapted from SantaClaas/flashcut (src/lib/broadcast.ts), without the Solid dependency. The
// leader election's calls go through ./service.ts on a channel of their own.
import { PROTOCOL_VERSION } from "./protocol/index.ts";

const BROADCAST_NAME = "week-budget-planner";

/**
 * App-level change events so other tabs reload the plan. The posting tab updates itself directly
 * (a BroadcastChannel does not deliver messages back to the poster).
 */
export type BroadcastMessage = { protocolVersion: number; type: "plan-changed" };

let sender: BroadcastChannel | undefined;

export function broadcastMessage(message: Omit<BroadcastMessage, "protocolVersion">): void {
  if (typeof BroadcastChannel === "undefined") return;
  sender ??= new BroadcastChannel(BROADCAST_NAME);
  sender.postMessage({ protocolVersion: PROTOCOL_VERSION, ...message } satisfies BroadcastMessage);
}

const doNothing = (): void => {};

/** Listens for change events from other tabs. Returns a function that stops listening. */
export function listenForBroadcasts(callback: (message: BroadcastMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return doNothing;
  const receiver = new BroadcastChannel(BROADCAST_NAME);
  receiver.addEventListener("message", (event: MessageEvent<BroadcastMessage>) => {
    // A tab never interprets a message of another version (see ./protocol/index.ts).
    if (event.data.protocolVersion !== PROTOCOL_VERSION) return;
    callback(event.data);
  });
  return () => {
    receiver.close();
  };
}
