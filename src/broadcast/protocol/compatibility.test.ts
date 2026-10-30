import { describe, expect, expectTypeOf, it } from "vitest";

import type { BroadcastMessage } from "../index.ts";
import type { ServiceMessage } from "../service.ts";
import { PROTOCOL_VERSION } from "./index.ts";
import type * as frozen from "./version-1.ts";

// Tabs on different versions of the app talk to each other, so a message that changes shape must
// change the protocol version too. Like cargo-semver-checks, this compares the messages with the
// version they claim to be: while the version stays, each side has to read what the other sends.
// The type checks run in `pnpm typecheck`; the runtime check fails when the version is bumped
// without freezing its messages and pointing the import above at them.
describe("the protocol between tabs", () => {
  it("is the version whose messages are frozen", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("still reads and sends the messages of its version", () => {
    // A newer tab reads what an older tab sends, and the other way round.
    expectTypeOf<frozen.ServiceMessage>().toExtend<ServiceMessage>();
    expectTypeOf<ServiceMessage>().toExtend<frozen.ServiceMessage>();
    expectTypeOf<frozen.BroadcastMessage>().toExtend<BroadcastMessage>();
    expectTypeOf<BroadcastMessage>().toExtend<frozen.BroadcastMessage>();
  });
});
