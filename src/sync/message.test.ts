import { describe, expect, it } from "vitest";

import { FORMAT_VERSION, convertPlan, takeSnapshot } from "../merge/index.ts";
import { createEmptyPlan } from "../plan/index.ts";
import { PROTOCOL_VERSION, parseMessage } from "./message.ts";

const groupId = "0123456789abcdef0123456789abcdef";
const emptyChange = takeSnapshot(convertPlan(createEmptyPlan()));

describe("parsing protocol messages", () => {
  it("parses valid Hello, Rows, Have and Refused messages", () => {
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 4,
        received: 2,
      }),
    ).toEqual({
      type: "hello",
      version: PROTOCOL_VERSION,
      groupId,
      counter: 4,
      received: 2,
    });

    expect(parseMessage({ type: "rows", change: emptyChange, upTo: 7 })).toEqual({
      type: "rows",
      change: emptyChange,
      upTo: 7,
    });

    expect(parseMessage({ type: "have", received: 7 })).toEqual({
      type: "have",
      received: 7,
    });

    expect(parseMessage({ type: "refused", reason: "not-in-group" })).toEqual({
      type: "refused",
      reason: "not-in-group",
    });
    expect(parseMessage({ type: "refused", reason: "newer-version" })).toEqual({
      type: "refused",
      reason: "newer-version",
    });
  });

  it("reports newer-version for a newer Hello even if its shape changed", () => {
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION + 1,
        extraFieldFromFuture: true,
      }),
    ).toBe("newer-version");
  });

  it("reports newer-version for a Rows message with a newer change format", () => {
    expect(
      parseMessage({
        type: "rows",
        change: { version: FORMAT_VERSION + 1, future: true },
        upTo: 1,
      }),
    ).toBe("newer-version");
  });

  it("refuses malformed messages, unknown fields and out-of-range counters", () => {
    expect(parseMessage(null)).toBe("not-a-message");
    expect(parseMessage([])).toBe("not-a-message");
    expect(parseMessage({ type: "unknown" })).toBe("not-a-message");

    // Hello checks
    expect(parseMessage({ type: "hello", version: 0, groupId, counter: 0, received: 0 })).toBe(
      "not-a-message",
    );
    expect(parseMessage({ type: "hello", version: 1.5, groupId, counter: 0, received: 0 })).toBe(
      "not-a-message",
    );
    expect(parseMessage({ type: "hello", version: PROTOCOL_VERSION, groupId, counter: 0 })).toBe(
      "not-a-message",
    );
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 0,
        received: 0,
        extra: 1,
      }),
    ).toBe("not-a-message");
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId: "bad",
        counter: 0,
        received: 0,
      }),
    ).toBe("invalid-group");
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: -1,
        received: 0,
      }),
    ).toBe("invalid-counter");
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: "1",
        received: 0,
      }),
    ).toBe("invalid-counter");
    expect(
      parseMessage({
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 0,
        received: 1.5,
      }),
    ).toBe("invalid-counter");

    // Rows checks
    expect(parseMessage({ type: "rows", change: emptyChange })).toBe("not-a-message");
    expect(parseMessage({ type: "rows", change: { version: 1 }, upTo: 1 })).toBe("not-a-change");
    expect(parseMessage({ type: "rows", change: emptyChange, upTo: -1 })).toBe("invalid-counter");
    expect(parseMessage({ type: "rows", change: emptyChange, upTo: "1" })).toBe("invalid-counter");

    // Have checks
    expect(parseMessage({ type: "have" })).toBe("not-a-message");
    expect(parseMessage({ type: "have", received: 1, extra: true })).toBe("not-a-message");
    expect(parseMessage({ type: "have", received: -1 })).toBe("invalid-counter");

    // Refused checks
    expect(parseMessage({ type: "refused" })).toBe("not-a-message");
    expect(parseMessage({ type: "refused", reason: "other" })).toBe("invalid-reason");
    expect(parseMessage({ type: "refused", reason: "not-in-group", extra: 1 })).toBe(
      "not-a-message",
    );
  });
});
