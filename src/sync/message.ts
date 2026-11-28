// The messages two devices exchange in self-service syncing (see The messages in
// docs/spec/self-service.md), and strict parsing of received ones before the state machine acts on
// them.
import { parse as parseChange, type Problem as ChangeProblem } from "../merge/check.ts";
import type { Change } from "../merge/index.ts";
import { isRecord, readExact } from "../merge/record.ts";
import type { Result } from "../result.ts";
import { parseGroupId, type GroupId } from "./group.ts";
import { parseChangeNumber, type ChangeNumber } from "./origin.ts";

/** The self-service protocol version this app speaks. A higher version asks the user to reload. */
export const PROTOCOL_VERSION = 1;

/** Why a device refused a connection. */
type RefusalReason = "not-in-group" | "newer-version";

export type HelloMessage = {
  readonly type: "hello";
  readonly version: typeof PROTOCOL_VERSION;
  readonly groupId: GroupId;
  /** The sender's own change counter. */
  readonly counter: ChangeNumber;
  /** The receiver's change counter up to which the sender has merged its changes. */
  readonly received: ChangeNumber;
};

export type RowsMessage = {
  readonly type: "rows";
  readonly change: Change;
  /** The sender's counter value these rows bring the receiver up to. */
  readonly upTo: ChangeNumber;
};

export type HaveMessage = {
  readonly type: "have";
  /** The receiver's counter value up to which the sender now has its changes. */
  readonly received: ChangeNumber;
};

export type RefusedMessage = {
  readonly type: "refused";
  readonly reason: RefusalReason;
};

export type Message = HelloMessage | RowsMessage | HaveMessage | RefusedMessage;

/** Why a received message was refused. `"newer-version"` comes from either `Hello` or `Rows`. */
export type MessageProblem =
  | ChangeProblem
  | "not-a-message"
  | "invalid-group"
  | "invalid-counter"
  | "invalid-reason";

const parseCounter = (value: unknown): Result<ChangeNumber, "invalid-counter"> => {
  if (typeof value !== "number") return "invalid-counter";

  const parsed = parseChangeNumber(value);
  return parsed === "out-of-range" ? "invalid-counter" : parsed;
};

const isFromNewerProtocol = (value: Record<string, unknown>): boolean =>
  typeof value["version"] === "number" &&
  Number.isSafeInteger(value["version"]) &&
  value["version"] > PROTOCOL_VERSION;

function parseHello(value: Record<string, unknown>): Result<HelloMessage, MessageProblem> {
  if (isFromNewerProtocol(value)) return "newer-version";

  const fields = readExact(value, ["type", "version", "groupId", "counter", "received"]);
  if (fields?.["version"] !== PROTOCOL_VERSION) return "not-a-message";

  const groupId = parseGroupId(fields["groupId"]);
  if (groupId === undefined) return "invalid-group";

  const counter = parseCounter(fields["counter"]);
  if (typeof counter === "string") return counter;

  const received = parseCounter(fields["received"]);
  if (typeof received === "string") return received;

  return { type: "hello", version: PROTOCOL_VERSION, groupId, counter, received };
}

function parseRows(value: Record<string, unknown>): Result<RowsMessage, MessageProblem> {
  const fields = readExact(value, ["type", "change", "upTo"]);
  if (fields === undefined) return "not-a-message";

  const change = parseChange(fields["change"]);
  if (typeof change === "string") return change;

  const upTo = parseCounter(fields["upTo"]);
  if (typeof upTo === "string") return upTo;

  return { type: "rows", change, upTo };
}

function parseHave(value: Record<string, unknown>): Result<HaveMessage, MessageProblem> {
  const fields = readExact(value, ["type", "received"]);
  if (fields === undefined) return "not-a-message";

  const received = parseCounter(fields["received"]);
  if (typeof received === "string") return received;

  return { type: "have", received };
}

function parseRefused(value: Record<string, unknown>): Result<RefusedMessage, MessageProblem> {
  const fields = readExact(value, ["type", "reason"]);
  if (fields === undefined) return "not-a-message";

  const reason = fields["reason"];
  if (reason !== "not-in-group" && reason !== "newer-version") return "invalid-reason";

  return { type: "refused", reason };
}

/**
 * Parses a received protocol message strictly. A `Hello` from a newer protocol version or a `Rows`
 * carrying a newer change format returns `"newer-version"` so the caller can offer to reload.
 */
export function parseMessage(value: unknown): Result<Message, MessageProblem> {
  if (!isRecord(value)) return "not-a-message";

  switch (value["type"]) {
    case "hello":
      return parseHello(value);
    case "rows":
      return parseRows(value);
    case "have":
      return parseHave(value);
    case "refused":
      return parseRefused(value);
    default:
      return "not-a-message";
  }
}
