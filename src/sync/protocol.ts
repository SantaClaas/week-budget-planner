// One device's side of the self-service sync protocol as a pure state machine (see The messages
// and Tests in docs/spec/self-service.md). Messages, connection changes and local saves go in;
// messages to send, rows and progress to persist, and lifecycle notices come out. No I/O, no clock
// and no randomness.
import type { DeviceKey } from "../device/index.ts";
import {
  FORMAT_VERSION,
  findLatestStamp,
  merge,
  takeSnapshot,
  type Change,
  type Rows,
} from "../merge/index.ts";
import type { Stamp } from "../merge/stamp.ts";
import type { GroupId } from "./group.ts";
import {
  PROTOCOL_VERSION,
  parseMessage,
  type HaveMessage,
  type HelloMessage,
  type Message,
  type RefusedMessage,
  type RowsMessage,
} from "./message.ts";
import {
  NO_CHANGE,
  collectSince,
  incrementChangeNumber,
  noteMerge,
  type ChangeNumber,
  type Origins,
} from "./origin.ts";

/**
 * How far this device and one other device have each other's changes, matching the `progress`
 * table (see What a device keeps for syncing in docs/spec/self-service.md).
 */
export type PeerProgress = {
  /** The other device's counter up to which this device has merged its changes. */
  readonly received: ChangeNumber;
  /** This device's counter up to which the other device has confirmed receiving them. */
  readonly delivered: ChangeNumber;
};

/** Ephemeral state for one currently open connection. */
type PeerConnection =
  | {
      readonly phase: "awaiting-hello";
      /** This device's counter when it sent Hello on this connection. */
      readonly helloCounter: ChangeNumber;
    }
  | {
      readonly phase: "ready";
      /** This device's counter up to which owed rows have already been sent on this connection. */
      readonly sentUpTo: ChangeNumber;
    };

/** Whether syncing is active on this device, or turned off after it was removed from the group. */
type SyncStatus = "active" | "removed";

/** Everything the pure state machine holds for one device. */
export type ProtocolState = {
  readonly self: DeviceKey;
  readonly groupId: GroupId;
  readonly rows: Rows;
  readonly origins: Origins;
  readonly counter: ChangeNumber;
  /** Persisted progress per peer. */
  readonly progress: ReadonlyMap<DeviceKey, PeerProgress>;
  /** Currently open connections. */
  readonly peers: ReadonlyMap<DeviceKey, PeerConnection>;
  readonly status: SyncStatus;
};

/** What can happen to the state machine. */
export type ProtocolInput =
  | { readonly type: "connected"; readonly peer: DeviceKey }
  | { readonly type: "disconnected"; readonly peer: DeviceKey }
  | { readonly type: "received"; readonly peer: DeviceKey; readonly message: unknown }
  | {
      readonly type: "local-change";
      readonly rows: Rows;
      readonly origins: Origins;
      readonly counter: ChangeNumber;
    };

/** What the edge must carry out after a step. */
export type ProtocolEffect =
  | { readonly type: "send"; readonly peer: DeviceKey; readonly message: Message }
  | { readonly type: "close"; readonly peer: DeviceKey }
  | {
      readonly type: "persist-merge";
      readonly rows: Rows;
      /** Only the post-merge rows whose values changed, ready for `buildChangeStatements`. */
      readonly written: Change;
      readonly origins: Origins;
      readonly counter: ChangeNumber;
      readonly latestStamp: Stamp;
      readonly sender: DeviceKey;
    }
  | { readonly type: "persist-progress"; readonly peer: DeviceKey; readonly progress: PeerProgress }
  | { readonly type: "sync-disabled"; readonly reason: "removed" }
  | { readonly type: "reload-needed" };

export type StepResult = {
  readonly state: ProtocolState;
  readonly effects: readonly ProtocolEffect[];
};

const NO_PROGRESS: PeerProgress = { received: NO_CHANGE, delivered: NO_CHANGE };

const readProgress = (
  progress: ReadonlyMap<DeviceKey, PeerProgress>,
  peer: DeviceKey,
): PeerProgress => progress.get(peer) ?? NO_PROGRESS;

const findHigher = (first: ChangeNumber, second: ChangeNumber): ChangeNumber =>
  first > second ? first : second;

/** Whether `device` is currently in the group (a member or a temporary window, not removed). */
const isInGroup = (rows: Rows, device: DeviceKey): boolean => {
  const row = rows.devices.get(device);
  return row !== undefined && row.membership.value.status !== "removed";
};

/** Whether `device` is explicitly marked removed in the device list. */
const isRemovedDevice = (rows: Rows, device: DeviceKey): boolean =>
  rows.devices.get(device)?.membership.value.status === "removed";

/** Whether a change carries at least one row to send. */
const isNonEmptyChange = (change: Change): boolean =>
  change.activities.length > 0 ||
  change.blocks.length > 0 ||
  change.settings !== null ||
  change.devices.length > 0;

/** Open connections in deterministic peer order so effects don't depend on map insertion order. */
const listSortedPeers = (
  peers: ReadonlyMap<DeviceKey, PeerConnection>,
): [DeviceKey, PeerConnection][] =>
  peers
    .entries()
    .toArray()
    .toSorted(([first], [second]) => (first < second ? -1 : 1));

/** The rows that `merge()` replaced, by object identity, sorted by id. */
function collectChangedRows<Key extends string, Row extends { readonly id: Key }>(
  before: ReadonlyMap<Key, Row>,
  after: ReadonlyMap<Key, Row>,
): Row[] {
  return after
    .entries()
    .filter(([key, row]) => before.get(key) !== row)
    .map(([, row]) => row)
    .toArray()
    .toSorted((first, second) => (first.id < second.id ? -1 : 1));
}

/** The minimal change holding only the post-merge rows that differ from `before`. */
function collectWritten(before: Rows, after: Rows): Change {
  return {
    version: FORMAT_VERSION,
    activities: collectChangedRows(before.activities, after.activities),
    blocks: collectChangedRows(before.blocks, after.blocks),
    settings: before.settings === after.settings ? null : after.settings,
    devices: collectChangedRows(before.devices, after.devices),
  };
}

function advanceCounter(counter: ChangeNumber): ChangeNumber {
  const next = incrementChangeNumber(counter);
  if (next === "out-of-range") throw new RangeError("Sync change counter overflowed.");

  return next;
}

/** Removes `peer` from open connections and asks the edge to close it. */
function closePeer(
  state: ProtocolState,
  peer: DeviceKey,
  prefix: readonly ProtocolEffect[] = [],
): StepResult {
  const peers = new Map(state.peers);
  peers.delete(peer);
  return {
    state: { ...state, peers },
    effects: [...prefix, { type: "close", peer }],
  };
}

/** Turns syncing off after this device is removed, closing every open connection. */
function stopSyncing(state: ProtocolState, prefix: readonly ProtocolEffect[] = []): StepResult {
  const closes: ProtocolEffect[] = listSortedPeers(state.peers).map(([peer]) => ({
    type: "close",
    peer,
  }));
  return {
    state: { ...state, peers: new Map(), status: "removed" },
    effects: [...prefix, ...closes, { type: "sync-disabled", reason: "removed" }],
  };
}

/**
 * Refuses any connected peer that is no longer in the group, and pushes owed rows to every
 * remaining ready peer.
 */
function updatePeers(
  state: ProtocolState,
  prefix: readonly ProtocolEffect[],
  shouldPushRows: boolean,
): StepResult {
  const peers = new Map(state.peers);
  const effects: ProtocolEffect[] = [...prefix];
  for (const [peer, connection] of listSortedPeers(state.peers)) {
    if (!isInGroup(state.rows, peer)) {
      peers.delete(peer);
      if (isRemovedDevice(state.rows, peer)) {
        effects.push({ type: "send", peer, message: { type: "refused", reason: "not-in-group" } });
      }

      effects.push({ type: "close", peer });
      continue;
    }

    if (!shouldPushRows || connection.phase !== "ready") continue;

    const owed = collectSince(state.rows, state.origins, connection.sentUpTo, peer);
    if (!isNonEmptyChange(owed)) continue;

    peers.set(peer, { phase: "ready", sentUpTo: state.counter });
    effects.push({
      type: "send",
      peer,
      message: { type: "rows", change: owed, upTo: state.counter },
    });
  }

  return { state: { ...state, peers }, effects };
}

function handleConnected(state: ProtocolState, peer: DeviceKey): StepResult {
  if (state.status === "removed" || peer === state.self) {
    return { state, effects: [{ type: "close", peer }] };
  }

  // Only tell a peer it was removed when we have an explicit removal row for it; an unknown key
  // could be a device another member just added before we synced with them.
  if (isRemovedDevice(state.rows, peer)) {
    return {
      state,
      effects: [
        { type: "send", peer, message: { type: "refused", reason: "not-in-group" } },
        { type: "close", peer },
      ],
    };
  }

  if (!isInGroup(state.rows, peer)) return { state, effects: [{ type: "close", peer }] };

  const peers = new Map<DeviceKey, PeerConnection>([
    ...state.peers,
    [peer, { phase: "awaiting-hello", helloCounter: state.counter }],
  ]);
  const message: HelloMessage = {
    type: "hello",
    version: PROTOCOL_VERSION,
    groupId: state.groupId,
    counter: state.counter,
    received: readProgress(state.progress, peer).received,
  };
  return {
    state: { ...state, peers },
    effects: [{ type: "send", peer, message }],
  };
}

function handleDisconnected(state: ProtocolState, peer: DeviceKey): StepResult {
  if (!state.peers.has(peer)) return { state, effects: [] };

  const peers = new Map(state.peers);
  peers.delete(peer);
  return { state: { ...state, peers }, effects: [] };
}

function handleHello(
  state: ProtocolState,
  peer: DeviceKey,
  connection: PeerConnection,
  message: HelloMessage,
): StepResult {
  if (connection.phase !== "awaiting-hello") return closePeer(state, peer);

  if (message.groupId !== state.groupId) {
    return closePeer(state, peer, [
      { type: "send", peer, message: { type: "refused", reason: "not-in-group" } },
    ]);
  }

  const current = readProgress(state.progress, peer);
  // A peer claiming more of our changes than we had when we sent Hello outlived our data (we were
  // restored); a peer whose counter is below what we already received rolled back (the peer was
  // restored). In either case we reset the affected cursor and send a full snapshot so neither
  // side misses rows that originally came from the other.
  const isPeerOutlivingUs = message.received > connection.helloCounter;
  const isPeerRolledBack = message.counter < current.received;
  const nextProgress: PeerProgress = {
    received: isPeerRolledBack ? NO_CHANGE : current.received,
    delivered: isPeerOutlivingUs ? NO_CHANGE : message.received,
  };
  const progress = new Map(state.progress);
  const effects: ProtocolEffect[] = [];
  if (nextProgress.received !== current.received || nextProgress.delivered !== current.delivered) {
    progress.set(peer, nextProgress);
    effects.push({ type: "persist-progress", peer, progress: nextProgress });
  }

  const shouldSendSnapshot =
    isPeerOutlivingUs || isPeerRolledBack || nextProgress.delivered === NO_CHANGE;
  const change = shouldSendSnapshot
    ? takeSnapshot(state.rows)
    : collectSince(state.rows, state.origins, nextProgress.delivered, peer);
  if (isNonEmptyChange(change)) {
    effects.push({
      type: "send",
      peer,
      message: { type: "rows", change, upTo: state.counter },
    });
  }

  const peers = new Map<DeviceKey, PeerConnection>([
    ...state.peers,
    [peer, { phase: "ready", sentUpTo: state.counter }],
  ]);
  return { state: { ...state, progress, peers }, effects };
}

function handleRows(
  state: ProtocolState,
  peer: DeviceKey,
  connection: PeerConnection,
  message: RowsMessage,
): StepResult {
  if (connection.phase !== "ready") return closePeer(state, peer);

  const merged = merge(state.rows, message.change);
  const written = collectWritten(state.rows, merged);
  const hasChanged = isNonEmptyChange(written);
  const effects: ProtocolEffect[] = [];
  let nextState = state;
  if (hasChanged) {
    const counter = advanceCounter(state.counter);
    const origins = noteMerge(state.rows, merged, message.change, state.origins, counter, peer);
    nextState = { ...state, rows: merged, origins, counter };
    effects.push({
      type: "persist-merge",
      rows: merged,
      written,
      origins,
      counter,
      latestStamp: findLatestStamp(message.change),
      sender: peer,
    });
  }

  const current = readProgress(nextState.progress, peer);
  const received = findHigher(current.received, message.upTo);
  if (received !== current.received) {
    const nextProgress: PeerProgress = { received, delivered: current.delivered };
    const progress = new Map<DeviceKey, PeerProgress>([
      ...nextState.progress,
      [peer, nextProgress],
    ]);
    nextState = { ...nextState, progress };
    effects.push({ type: "persist-progress", peer, progress: nextProgress });
  }

  const isSelfRemoved =
    nextState.rows.devices.get(nextState.self)?.membership.value.status === "removed";
  if (isSelfRemoved) return stopSyncing(nextState, effects);

  if (isInGroup(nextState.rows, peer)) {
    effects.push({ type: "send", peer, message: { type: "have", received } });
  }

  return updatePeers(nextState, effects, hasChanged);
}

function handleHave(
  state: ProtocolState,
  peer: DeviceKey,
  connection: PeerConnection,
  message: HaveMessage,
): StepResult {
  if (connection.phase !== "ready" || message.received > state.counter) {
    return closePeer(state, peer);
  }

  const current = readProgress(state.progress, peer);
  const delivered = findHigher(current.delivered, message.received);
  if (delivered === current.delivered) return { state, effects: [] };

  const nextProgress: PeerProgress = { received: current.received, delivered };
  const progress = new Map<DeviceKey, PeerProgress>([...state.progress, [peer, nextProgress]]);
  return {
    state: { ...state, progress },
    effects: [{ type: "persist-progress", peer, progress: nextProgress }],
  };
}

function handleRefused(state: ProtocolState, peer: DeviceKey, message: RefusedMessage): StepResult {
  if (message.reason === "not-in-group") return stopSyncing(state);

  return closePeer(state, peer, [{ type: "reload-needed" }]);
}

function handleReceived(state: ProtocolState, peer: DeviceKey, raw: unknown): StepResult {
  const connection = state.peers.get(peer);
  if (connection === undefined) return { state, effects: [] };

  const parsed = parseMessage(raw);
  if (parsed === "newer-version") return closePeer(state, peer, [{ type: "reload-needed" }]);

  if (typeof parsed === "string") return closePeer(state, peer);

  let result: StepResult;
  switch (parsed.type) {
    case "hello":
      result = handleHello(state, peer, connection, parsed);
      break;
    case "rows":
      result = handleRows(state, peer, connection, parsed);
      break;
    case "have":
      result = handleHave(state, peer, connection, parsed);
      break;
    case "refused":
      result = handleRefused(state, peer, parsed);
      break;
  }

  return result;
}

function handleLocalChange(
  state: ProtocolState,
  rows: Rows,
  origins: Origins,
  counter: ChangeNumber,
): StepResult {
  const nextState: ProtocolState = { ...state, rows, origins, counter };
  if (state.status === "removed") return { state: nextState, effects: [] };

  const isSelfRemoved = rows.devices.get(state.self)?.membership.value.status === "removed";
  if (isSelfRemoved) return stopSyncing(nextState);

  return updatePeers(nextState, [], true);
}

/** Creates the initial protocol state for a device from what it holds in storage. */
export function createProtocolState(initial: {
  readonly self: DeviceKey;
  readonly groupId: GroupId;
  readonly rows: Rows;
  readonly origins: Origins;
  readonly counter: ChangeNumber;
  readonly progress?: ReadonlyMap<DeviceKey, PeerProgress>;
}): ProtocolState {
  return {
    self: initial.self,
    groupId: initial.groupId,
    rows: initial.rows,
    origins: initial.origins,
    counter: initial.counter,
    progress: new Map(initial.progress ?? []),
    peers: new Map(),
    status:
      initial.rows.devices.get(initial.self)?.membership.value.status === "removed"
        ? "removed"
        : "active",
  };
}

/** Advances the pure self-service sync state machine by one input. */
export function stepProtocol(state: ProtocolState, input: ProtocolInput): StepResult {
  let result: StepResult;
  switch (input.type) {
    case "connected":
      result = handleConnected(state, input.peer);
      break;
    case "disconnected":
      result = handleDisconnected(state, input.peer);
      break;
    case "received":
      result = handleReceived(state, input.peer, input.message);
      break;
    case "local-change":
      result = handleLocalChange(state, input.rows, input.origins, input.counter);
      break;
  }

  return result;
}
