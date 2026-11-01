import { describe, expect, it } from "vitest";

import { broadcastMessage, listenForBroadcasts, type BroadcastMessage } from "./index.ts";
import { PROTOCOL_VERSION } from "./protocol/index.ts";

/** Waits long enough for a BroadcastChannel message to arrive. */
const waitForDelivery = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 50);
  });

describe("broadcast", () => {
  it("tells other tabs about a change, but not the tab that made it", async () => {
    // Another tab is another channel of the same name.
    const otherTab = new BroadcastChannel("week-budget-planner");
    const heardByOtherTab: unknown[] = [];
    otherTab.addEventListener("message", (event: MessageEvent<unknown>) => {
      heardByOtherTab.push(event.data);
    });
    const heardHere: BroadcastMessage[] = [];
    const stopListening = listenForBroadcasts((message) => {
      heardHere.push(message);
    });

    broadcastMessage({ type: "plan-changed" });
    await waitForDelivery();
    expect(heardByOtherTab).toEqual([{ protocolVersion: PROTOCOL_VERSION, type: "plan-changed" }]);
    expect(heardHere).toEqual([]);

    otherTab.postMessage({ protocolVersion: PROTOCOL_VERSION, type: "plan-changed" });
    await waitForDelivery();
    expect(heardHere).toEqual([{ protocolVersion: PROTOCOL_VERSION, type: "plan-changed" }]);

    stopListening();
    otherTab.close();
  });
});
