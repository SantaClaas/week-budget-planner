// Deterministic simulation of the self-service sync protocol (see Tests in
// docs/spec/self-service.md): several devices in one process, connected only along a sparse graph
// so some devices never meet directly, with connections opening and dropping at any point,
// devices added, removed and restored from an older copy. The same seed replays the same run:
// SYNC_SEED=<seed> pnpm test src/sync/simulation.test.ts runs one seed; SYNC_SEEDS_FROM=<seed>
// runs a batch starting there.
//
// The random numbers come from mulberry32, a public-domain generator by Tommy Ettinger
// (https://gist.github.com/tommyettinger/46a874533244883189143505d203312c), written anew here.
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import type { DeviceKey } from "../device/index.ts";
import { make } from "../merge/change.ts";
import { advance, issueNext } from "../merge/clock.ts";
import { convertPlan, readPlan, type Rows } from "../merge/index.ts";
import type { DeviceRow } from "../merge/row.ts";
import { LOWEST, sanitizeTime, type NodeId, type Stamp } from "../merge/stamp.ts";
import { createDevice, createNodeId, requireValue } from "../merge/test-data.ts";
import * as activityList from "../plan/activity/list.ts";
import { PALETTE } from "../plan/activity/look.ts";
import * as blockList from "../plan/block/list.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createActivity, createBlock } from "../plan/test-data.ts";
import { DAY, SLOT, sanitizeDayEnd, sanitizeDayStart } from "../plan/time.ts";
import { parseGroupId } from "./group.ts";
import type { Message } from "./message.ts";
import {
  createEmptyOrigins,
  incrementChangeNumber,
  noteAction,
  parseChangeNumber,
  type ChangeNumber,
  type Origins,
} from "./origin.ts";
import {
  createProtocolState,
  stepProtocol,
  type PeerProgress,
  type ProtocolEffect,
  type ProtocolState,
} from "./protocol.ts";

const RUNS = 400;
const BATCH = 25;
const START = 1_763_200_000_000;
const GROUP_ID = requireValue(parseGroupId("0123456789abcdef0123456789abcdef"), "group id");
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c"] as const;
const NAMES = ["Work", "Gym", "Read", "Cook", "Run", "Yoga", "Study", "Swim"];

/** A seeded random number generator (mulberry32): the same seed, the same numbers. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const pickFraction = (): number => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const pickInteger = (low: number, high: number): number =>
    low + Math.floor(pickFraction() * (high - low + 1));
  const pick = <Value>(values: readonly Value[]): Value | undefined =>
    values[pickInteger(0, values.length - 1)];
  const isChance = (probability: number): boolean => pickFraction() < probability;
  return { pickFraction, pickInteger, pick, isChance };
}

type Random = ReturnType<typeof createRandom>;

type SavedCopy = {
  readonly clock: Stamp;
  readonly rows: Rows;
  readonly origins: Origins;
  readonly counter: ChangeNumber;
  readonly progress: ReadonlyMap<DeviceKey, PeerProgress>;
};

type SimulatedDevice = {
  readonly key: DeviceKey;
  nodeId: NodeId;
  readonly row: DeviceRow;
  clock: Stamp;
  state: ProtocolState;
  savedCopy: SavedCopy | undefined;
};

/** One directed wire between two connected devices, carrying ordered in-flight messages. */
type Wire = {
  readonly from: DeviceKey;
  readonly to: DeviceKey;
  readonly messages: Message[];
};

const createCounter = (value: number): ChangeNumber => {
  const parsed = parseChangeNumber(value);
  if (parsed === "out-of-range") throw new Error(`Invalid counter: ${String(value)}.`);

  return parsed;
};

const formatPair = (first: DeviceKey, second: DeviceKey): string =>
  first < second ? `${first}:${second}` : `${second}:${first}`;

function pickNextStamp(device: SimulatedDevice, now: number): Stamp {
  const time = sanitizeTime(Temporal.Instant.fromEpochMilliseconds(now));
  const stamp = issueNext(device.clock, time, device.nodeId);
  if (stamp === undefined) throw new Error("Simulation clock exhausted.");

  device.clock = stamp;
  return stamp;
}

function advanceDeviceCounter(device: SimulatedDevice): ChangeNumber {
  const next = incrementChangeNumber(device.state.counter);
  if (next === "out-of-range") throw new Error("Simulation counter overflowed.");

  return next;
}

function performRandomEdit(
  shown: Plan,
  random: Random,
  createId: (prefix: "a" | "b") => string,
): Plan {
  const choice = random.pickInteger(0, 5);
  if (choice === 0 || shown.activities.length === 0) {
    const added = createActivity({
      id: createId("a"),
      name: random.pick(NAMES) ?? "Work",
      hue: random.pick(PALETTE)?.hue ?? 255,
    });
    return activityList.add(shown, added);
  }

  if (choice === 1) {
    const target = random.pick(shown.activities);
    if (target === undefined) return shown;

    return activityList.update(shown, target.id, {
      ...target,
      name: createActivity({ name: random.pick(NAMES) ?? "Work" }).name,
      hue: random.pick(PALETTE)?.hue ?? target.hue,
    });
  }

  if (choice === 2 && shown.activities.length > 1) {
    const target = random.pick(shown.activities);
    return target === undefined ? shown : activityList.remove(shown, target.id).plan;
  }

  if (choice === 3) {
    const activity = random.pick(shown.activities);
    if (activity === undefined) return shown;

    const added = createBlock({
      id: createId("b"),
      activityId: activity.id,
      day: random.pickInteger(0, 6),
      start: SLOT * random.pickInteger(0, DAY / SLOT - 1),
      length: SLOT * random.pickInteger(1, 8),
    });
    return blockList.add(shown, added);
  }

  if (choice === 4 && shown.blocks.length > 0) {
    const target = random.pick(shown.blocks);
    if (target === undefined) return shown;

    return random.isChance(0.5)
      ? blockList.remove(shown, target.id)
      : blockList.update(shown, {
          ...target,
          start: createBlock({ start: SLOT * random.pickInteger(0, DAY / SLOT - 1) }).start,
        });
  }

  return {
    ...shown,
    dayStart: sanitizeDayStart(random.pickInteger(5, 10)),
    dayEnd: sanitizeDayEnd(random.pickInteger(18, 23)),
  };
}

/** Runs one seeded simulation and returns every broken invariant, empty when all hold. */
function runSimulation(seed: number): string[] {
  const random = createRandom(seed);
  const initialCount = random.pickInteger(3, 5);
  const steps = random.pickInteger(50, 120);
  let now = START;
  let idCounter = 0;
  const createId = (prefix: "a" | "b"): string => `${prefix}${String(++idCounter)}`;

  const initialRows = convertPlan(createEmptyPlan());
  const deviceRows: DeviceRow[] = [];
  for (let index = 0; index < initialCount; index++) {
    const digit = DIGITS[index];
    if (digit === undefined) throw new Error("Not enough device digits.");

    deviceRows.push(createDevice(digit, LOWEST));
  }

  const sharedRows: Rows = {
    ...initialRows,
    devices: new Map(deviceRows.values().map((row) => [row.id, row])),
  };
  const initialCounter = createCounter(1);
  const sharedOrigins = noteAction(
    convertPlan(createEmptyPlan()),
    sharedRows,
    createEmptyOrigins(),
    initialCounter,
  );

  const devices = new Map<DeviceKey, SimulatedDevice>();
  const deviceOrder: DeviceKey[] = [];
  for (const [index, row] of deviceRows.entries()) {
    const nodeId = createNodeId(`n${String(index)}`);
    const device: SimulatedDevice = {
      key: row.id,
      nodeId,
      row,
      clock: LOWEST,
      state: createProtocolState({
        self: row.id,
        groupId: GROUP_ID,
        rows: sharedRows,
        origins: sharedOrigins,
        counter: initialCounter,
      }),
      savedCopy: undefined,
    };
    devices.set(row.id, device);
    deviceOrder.push(row.id);
  }

  // Build a non-transitive connected graph (a chain, plus optionally one extra edge) so devices
  // at opposite ends can only sync through devices in between.
  const allowedPairs: [DeviceKey, DeviceKey][] = [];
  for (let index = 0; index + 1 < deviceOrder.length; index++) {
    const left = deviceOrder[index];
    const right = deviceOrder[index + 1];
    if (left !== undefined && right !== undefined) allowedPairs.push([left, right]);
  }

  const wires = new Map<string, [Wire, Wire]>();

  const disconnectPair = (firstKey: DeviceKey, secondKey: DeviceKey) => {
    const pairKey = formatPair(firstKey, secondKey);
    if (!wires.has(pairKey)) return;

    wires.delete(pairKey);
    const first = devices.get(firstKey);
    const second = devices.get(secondKey);
    if (first !== undefined) {
      first.state = stepProtocol(first.state, { type: "disconnected", peer: secondKey }).state;
    }

    if (second !== undefined) {
      second.state = stepProtocol(second.state, { type: "disconnected", peer: firstKey }).state;
    }
  };

  const applyEffects = (sender: SimulatedDevice, effects: readonly ProtocolEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "persist-merge": {
          sender.clock = advance(sender.clock, effect.latestStamp);
          break;
        }
        case "persist-progress":
        case "sync-disabled":
        case "reload-needed":
          break;
        case "send": {
          // A device that knows a peer is removed must never send it Rows.
          if (
            effect.message.type === "rows" &&
            sender.state.rows.devices.get(effect.peer)?.membership.value.status === "removed"
          ) {
            throw new Error(`Seed ${String(seed)}: sent Rows to removed peer ${effect.peer}.`);
          }

          const pair = wires.get(formatPair(sender.key, effect.peer));
          if (pair === undefined) break;

          const wire = pair[0].from === sender.key ? pair[0] : pair[1];
          wire.messages.push(effect.message);
          break;
        }
        case "close": {
          // Delivering Refused before disconnect is handled by only dropping the wire once empty,
          // or immediately when no wire holds a pending message from this sender.
          const pairKey = formatPair(sender.key, effect.peer);
          const pair = wires.get(pairKey);
          if (pair === undefined) break;

          const outgoing = pair[0].from === sender.key ? pair[0] : pair[1];
          if (outgoing.messages.length === 0) disconnectPair(sender.key, effect.peer);

          break;
        }
      }
    }
  };

  const connectPair = (firstKey: DeviceKey, secondKey: DeviceKey) => {
    const pairKey = formatPair(firstKey, secondKey);
    if (wires.has(pairKey)) return;

    const first = devices.get(firstKey);
    const second = devices.get(secondKey);
    if (first === undefined || second === undefined) return;

    wires.set(pairKey, [
      { from: firstKey, to: secondKey, messages: [] },
      { from: secondKey, to: firstKey, messages: [] },
    ]);
    const openFirst = stepProtocol(first.state, { type: "connected", peer: secondKey });
    first.state = openFirst.state;
    applyEffects(first, openFirst.effects);

    const openSecond = stepProtocol(second.state, { type: "connected", peer: firstKey });
    second.state = openSecond.state;
    applyEffects(second, openSecond.effects);
  };

  const deliverOneMessage = (wire: Wire): boolean => {
    const next = wire.messages.shift();
    if (next === undefined) return false;

    const receiver = devices.get(wire.to);
    if (receiver === undefined) return true;

    const copy: unknown = JSON.parse(JSON.stringify(next));
    const stepped = stepProtocol(receiver.state, {
      type: "received",
      peer: wire.from,
      message: copy,
    });
    receiver.state = stepped.state;
    applyEffects(receiver, stepped.effects);

    // If the sender already closed its side and its queue is now drained, close the pair.
    const sender = devices.get(wire.from);
    if (sender !== undefined && !sender.state.peers.has(wire.to) && wire.messages.length === 0) {
      disconnectPair(wire.from, wire.to);
    }

    return true;
  };

  const drainAll = () => {
    for (let guard = 0; guard < 10_000; guard++) {
      const next = wires
        .values()
        .flatMap(([first, second]) => [first, second])
        .find((wire) => wire.messages.length > 0);
      if (next === undefined) return;

      deliverOneMessage(next);
    }

    throw new Error(`Seed ${String(seed)}: messages did not settle.`);
  };

  let nextNewDeviceIndex = initialCount;
  let nextNodeIndex = initialCount;
  const removedKeys = new Set<DeviceKey>();

  const listActiveDevices = (): SimulatedDevice[] =>
    devices
      .values()
      .filter((device) => device.state.status === "active" && !removedKeys.has(device.key))
      .toArray();

  const listActiveNeighbors = (key: DeviceKey): DeviceKey[] => {
    const neighbors: DeviceKey[] = [];
    for (const [left, right] of allowedPairs) {
      if (left === key && !removedKeys.has(right)) neighbors.push(right);

      if (right === key && !removedKeys.has(left)) neighbors.push(left);
    }

    return neighbors;
  };

  // A copy can only be restored if it keeps every direct surviving neighbor on the spanning tree
  // in its device list and doesn't discard a removal that hasn't reached another surviving device.
  const canRestoreCopy = (device: SimulatedDevice, copy: SavedCopy): boolean => {
    for (const neighbor of listActiveNeighbors(device.key)) {
      if (!copy.rows.devices.has(neighbor)) return false;
    }

    const others = listActiveDevices().filter((other) => other.key !== device.key);
    for (const [key, row] of device.state.rows.devices) {
      if (row.membership.value.status !== "removed") continue;

      if (copy.rows.devices.get(key)?.membership.value.status === "removed") continue;

      const isKnownElsewhere = others.some(
        (other) => other.state.rows.devices.get(key)?.membership.value.status === "removed",
      );
      if (!isKnownElsewhere) return false;
    }

    return true;
  };

  for (let step = 0; step < steps; step++) {
    now += random.pickInteger(1, 5000);
    const roll = random.pickFraction();

    // 1. Local plan edit on an active device.
    if (roll < 0.32) {
      const device = random.pick(listActiveDevices());
      if (device === undefined) continue;

      const stamp = pickNextStamp(device, now);
      const made = make(
        device.state.rows,
        (shown) => performRandomEdit(shown, random, createId),
        stamp,
      );
      const counter = advanceDeviceCounter(device);
      const origins = noteAction(device.state.rows, made.rows, device.state.origins, counter);
      const stepped = stepProtocol(device.state, {
        type: "local-change",
        rows: made.rows,
        origins,
        counter,
      });
      device.state = stepped.state;
      applyEffects(device, stepped.effects);
      continue;
    }

    // 2. Deliver one in-flight message on a random open wire.
    if (roll < 0.68) {
      const nonEmpty = wires
        .values()
        .flatMap(([first, second]) => [first, second])
        .filter((wire) => wire.messages.length > 0)
        .toArray();
      const wire = random.pick(nonEmpty);
      if (wire !== undefined) deliverOneMessage(wire);

      continue;
    }

    // 3. Connect an allowed pair.
    if (roll < 0.82) {
      const pair = random.pick(allowedPairs);
      if (pair !== undefined) connectPair(pair[0], pair[1]);

      continue;
    }

    // 4. Drop an active connection mid-flight (losing any undelivered messages on it).
    if (roll < 0.91) {
      const openKeys = wires.keys().toArray();
      const chosen = random.pick(openKeys);
      if (chosen === undefined) continue;

      const pair = wires.get(chosen);
      if (pair !== undefined) disconnectPair(pair[0].from, pair[0].to);

      continue;
    }

    // 5. Save or restore a copy of one active device (testing both database-import restore and
    // raw OS rollback with outlived/rolled-back counters).
    if (roll < 0.95) {
      const device = random.pick(listActiveDevices());
      if (device === undefined) continue;

      if (device.savedCopy === undefined || random.isChance(0.5)) {
        device.savedCopy = {
          clock: device.clock,
          rows: device.state.rows,
          origins: device.state.origins,
          counter: device.state.counter,
          progress: new Map(device.state.progress),
        };
        continue;
      }

      const copy = device.savedCopy;
      if (!canRestoreCopy(device, copy)) continue;

      for (const peer of device.state.peers.keys()) disconnectPair(device.key, peer);

      if (random.isChance(0.5)) {
        // Raw disk rollback (see The messages in docs/spec/self-service.md): counter and progress
        // revert to the saved copy, then reconnect to active neighbors so outlived counters trigger
        // full-snapshot recovery before later edits reuse the same counter numbers.
        device.clock = copy.clock;
        device.state = createProtocolState({
          self: device.key,
          groupId: GROUP_ID,
          rows: copy.rows,
          origins: copy.origins,
          counter: copy.counter,
          progress: copy.progress,
        });
        for (const neighbor of listActiveNeighbors(device.key)) connectPair(device.key, neighbor);

        drainAll();
        continue;
      }

      // Database-file import (see Export and import in docs/spec/merge.md): new node id, later
      // clock, counter above both, every row marked changed at that counter, and empty progress.
      nextNodeIndex += 1;
      device.nodeId = createNodeId(`n${String(nextNodeIndex)}`);
      device.clock = advance(device.clock, copy.clock);
      const renewedCounter = advanceDeviceCounter(device);
      const renewedOrigins = noteAction(
        convertPlan(createEmptyPlan()),
        copy.rows,
        createEmptyOrigins(),
        renewedCounter,
      );
      device.state = createProtocolState({
        self: device.key,
        groupId: GROUP_ID,
        rows: copy.rows,
        origins: renewedOrigins,
        counter: renewedCounter,
      });
      continue;
    }

    const writeDeviceRow = (actor: SimulatedDevice, updatedRow: DeviceRow) => {
      const updatedDevices = new Map<DeviceKey, DeviceRow>([
        ...actor.state.rows.devices,
        [updatedRow.id, updatedRow],
      ]);
      const nextRows: Rows = { ...actor.state.rows, devices: updatedDevices };
      const counter = advanceDeviceCounter(actor);
      const origins = noteAction(actor.state.rows, nextRows, actor.state.origins, counter);
      const stepped = stepProtocol(actor.state, {
        type: "local-change",
        rows: nextRows,
        origins,
        counter,
      });
      actor.state = stepped.state;
      applyEffects(actor, stepped.effects);
    };

    // 6. Remove one leaf device (keeping the remaining graph connected and at least 2 active).
    if (roll >= 0.98 || nextNewDeviceIndex >= DIGITS.length) {
      const active = listActiveDevices();
      if (active.length <= 2) continue;

      const counts = new Map<DeviceKey, number>();
      for (const [left, right] of allowedPairs) {
        if (removedKeys.has(left) || removedKeys.has(right)) continue;

        counts.set(left, (counts.get(left) ?? 0) + 1);
        counts.set(right, (counts.get(right) ?? 0) + 1);
      }

      // Don't remove a device if it is the sole surviving holder of an earlier removal record.
      const leaves = active.filter((device) => {
        if ((counts.get(device.key) ?? 0) > 1) return false;

        const others = active.filter((other) => other.key !== device.key);
        for (const [key, row] of device.state.rows.devices) {
          if (row.membership.value.status !== "removed") continue;

          const isKnownElsewhere = others.some(
            (other) => other.state.rows.devices.get(key)?.membership.value.status === "removed",
          );
          if (!isKnownElsewhere) return false;
        }

        return true;
      });
      const victim = random.pick(leaves);
      if (victim === undefined) continue;

      const remover = random.pick(active.filter((device) => device.key !== victim.key));
      const existingRow = remover?.state.rows.devices.get(victim.key);
      if (remover === undefined || existingRow === undefined) continue;

      removedKeys.add(victim.key);
      const stamp = pickNextStamp(remover, now);
      writeDeviceRow(remover, {
        ...existingRow,
        membership: { value: { status: "removed", proof: null }, stamp },
      });
      continue;
    }

    // 7. Add a new device to the group (joining through one existing active device).
    const sponsor = random.pick(listActiveDevices());
    const digit = DIGITS[nextNewDeviceIndex];
    if (sponsor === undefined || digit === undefined) continue;

    nextNewDeviceIndex += 1;
    nextNodeIndex += 1;
    const stamp = pickNextStamp(sponsor, now);
    const addedRow = createDevice(digit, stamp);
    writeDeviceRow(sponsor, addedRow);

    // The new device starts empty, knowing its sponsor so it accepts the handshake.
    const emptyPlanRows = convertPlan(createEmptyPlan());
    const joinedRows: Rows = {
      ...emptyPlanRows,
      devices: new Map([
        [sponsor.key, sponsor.row],
        [addedRow.id, addedRow],
      ]),
    };
    const joinedCounter = createCounter(1);
    const joinedOrigins = noteAction(
      emptyPlanRows,
      joinedRows,
      createEmptyOrigins(),
      joinedCounter,
    );
    const joined: SimulatedDevice = {
      key: addedRow.id,
      nodeId: createNodeId(`n${String(nextNodeIndex)}`),
      row: addedRow,
      clock: LOWEST,
      state: createProtocolState({
        self: addedRow.id,
        groupId: GROUP_ID,
        rows: joinedRows,
        origins: joinedOrigins,
        counter: joinedCounter,
      }),
      savedCopy: undefined,
    };
    devices.set(addedRow.id, joined);
    deviceOrder.push(addedRow.id);
    allowedPairs.push([sponsor.key, addedRow.id]);
  }

  // Drain remaining messages, then run pairwise sync rounds across the surviving edges until
  // every surviving device has converged.
  drainAll();

  const survivingEdges = allowedPairs.filter(
    ([left, right]) => !removedKeys.has(left) && !removedKeys.has(right),
  );
  // Full passes over the spanning tree propagate changes from every leaf to every other leaf
  // (plus mixed-register merges back).
  for (let round = 0; round < devices.size + 2; round++) {
    for (const [left, right] of survivingEdges) {
      connectPair(left, right);
      drainAll();
    }
  }

  const survivors = devices
    .values()
    .filter((device) => !removedKeys.has(device.key))
    .toArray();
  const reference = survivors[0];
  if (reference === undefined) return [`Seed ${String(seed)}: no surviving devices.`];

  const problems: string[] = [];
  const referencePlan = readPlan(reference.state.rows);
  for (const device of survivors.slice(1)) {
    if (!isDeepStrictEqual(readPlan(device.state.rows), referencePlan)) {
      problems.push(
        `Seed ${String(seed)}: plan on ${device.key.slice(0, 4)} diverged from ${reference.key.slice(0, 4)}.`,
      );
    }

    if (!isDeepStrictEqual(device.state.rows, reference.state.rows)) {
      problems.push(
        `Seed ${String(seed)}: rows on ${device.key.slice(0, 4)} diverged from ${reference.key.slice(0, 4)}.`,
      );
    }
  }

  // Every removed device that connects to a survivor on its own list must be refused and turn
  // syncing off.
  for (const removedKey of removedKeys) {
    const removed = devices.get(removedKey);
    if (removed === undefined) continue;

    const knownSurvivor = survivors.find((candidate) =>
      removed.state.rows.devices.has(candidate.key),
    );
    if (knownSurvivor === undefined) continue;

    disconnectPair(knownSurvivor.key, removedKey);
    connectPair(knownSurvivor.key, removedKey);
    drainAll();
    if (removed.state.status !== "removed") {
      problems.push(
        `Seed ${String(seed)}: removed device ${removedKey.slice(0, 4)} did not stop syncing.`,
      );
    }
  }

  return problems;
}

const MAX_SEED = 0xffff_ffff;

function readSeed(name: string, max: number): number | undefined {
  const text = process.env[name];
  if (text === undefined) return undefined;

  const seed = Number(text);
  if (/^\d+$/u.test(text) && seed <= max) return seed;

  throw new RangeError(`${name} is "${text}", not a whole number from 0 to ${String(max)}.`);
}

function listBatches(): number[][] {
  const only = readSeed("SYNC_SEED", MAX_SEED);
  if (only !== undefined) return [[only]];

  const first = readSeed("SYNC_SEEDS_FROM", MAX_SEED - RUNS + 1) ?? 1;
  return Array.from({ length: RUNS / BATCH }, (_, batch) =>
    Array.from({ length: BATCH }, (_unused, index) => first + batch * BATCH + index),
  );
}

describe("self-service protocol simulation", () => {
  it.each(listBatches())("converges across partial graphs from seed %i on", (...seeds) => {
    expect(seeds.flatMap((seed) => runSimulation(seed))).toEqual([]);
  });
});
