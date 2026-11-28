import { describe, expect, it } from "vitest";

import type { DeviceKey } from "../device/index.ts";
import { make } from "../merge/change.ts";
import { convertPlan, readPlan, takeSnapshot, type Rows } from "../merge/index.ts";
import type { DeviceRow } from "../merge/row.ts";
import { createDevice, createStamp, requireValue } from "../merge/test-data.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createActivity, createBlock } from "../plan/test-data.ts";
import { sanitizeDayStart } from "../plan/time.ts";
import { parseGroupId } from "./group.ts";
import { PROTOCOL_VERSION, type Message } from "./message.ts";
import {
  NO_CHANGE,
  createEmptyOrigins,
  incrementChangeNumber,
  noteAction,
  parseChangeNumber,
  type ChangeNumber,
} from "./origin.ts";
import {
  createProtocolState,
  stepProtocol,
  type ProtocolEffect,
  type ProtocolState,
} from "./protocol.ts";

const groupId = requireValue(parseGroupId("0123456789abcdef0123456789abcdef"), "group id");
const otherGroupId = requireValue(parseGroupId("fedcba9876543210fedcba9876543210"), "group id");

const createCounter = (value: number): ChangeNumber => {
  const parsed = parseChangeNumber(value);
  if (parsed === "out-of-range") throw new Error(`Invalid test counter: ${String(value)}.`);

  return parsed;
};

const phoneRow = createDevice("a", createStamp(1_763_200_000_000, 0, "phone"));
const laptopRow = createDevice("b", createStamp(1_763_200_000_000, 0, "phone"));
const tabletRow = createDevice("c", createStamp(1_763_200_000_000, 0, "phone"));
const strangerRow = createDevice("d", createStamp(1_763_200_000_000, 0, "other"));

const basePlan: Plan = {
  ...createEmptyPlan(),
  activities: [createActivity({ id: "work", name: "Work" }), createActivity({ id: "gym" })],
  blocks: [createBlock({ id: "1", activityId: "work" })],
};

function createGroupState(
  self: DeviceKey,
  members: readonly DeviceRow[],
  plan: Plan = basePlan,
): ProtocolState {
  const initialRows = convertPlan(plan);
  const rows: Rows = {
    ...initialRows,
    devices: new Map(members.values().map((device) => [device.id, device])),
  };
  const counter = createCounter(1);
  const origins = noteAction(convertPlan(createEmptyPlan()), rows, createEmptyOrigins(), counter);
  return createProtocolState({ self, groupId, rows, origins, counter });
}

function applyLocalAction(
  state: ProtocolState,
  time: number,
  perform: (shown: Plan) => Plan,
): { state: ProtocolState; effects: readonly ProtocolEffect[] } {
  const made = make(state.rows, perform, createStamp(time, 0, state.self.slice(0, 8)));
  const counter = incrementChangeNumber(state.counter);
  if (counter === "out-of-range") throw new Error("Test counter overflowed.");

  const origins = noteAction(state.rows, made.rows, state.origins, counter);
  return stepProtocol(state, { type: "local-change", rows: made.rows, origins, counter });
}

function applyDeviceChange(
  state: ProtocolState,
  updated: DeviceRow,
): { state: ProtocolState; effects: readonly ProtocolEffect[] } {
  const devices = new Map<DeviceKey, DeviceRow>([...state.rows.devices, [updated.id, updated]]);
  const rows: Rows = { ...state.rows, devices };
  const counter = incrementChangeNumber(state.counter);
  if (counter === "out-of-range") throw new Error("Test counter overflowed.");

  const origins = noteAction(state.rows, rows, state.origins, counter);
  return stepProtocol(state, { type: "local-change", rows, origins, counter });
}

const renameWork =
  (name: string) =>
  (shown: Plan): Plan => ({
    ...shown,
    activities: shown.activities.map((activity) =>
      activity.id === "work" ? { ...activity, name: createActivity({ name }).name } : activity,
    ),
  });

const recolorWork = (shown: Plan): Plan => ({
  ...shown,
  activities: shown.activities.map((activity) =>
    activity.id === "work" ? { ...activity, hue: createActivity({ hue: 152 }).hue } : activity,
  ),
});

const findSent = (effects: readonly ProtocolEffect[], peer?: DeviceKey): Message[] =>
  effects
    .values()
    .filter(
      (effect): effect is Extract<ProtocolEffect, { type: "send" }> =>
        effect.type === "send" && (peer === undefined || effect.peer === peer),
    )
    .map((effect) => effect.message)
    .toArray();

/** Connects two protocol states and exchanges every message they produce until quiet. */
function syncPeers(
  first: ProtocolState,
  second: ProtocolState,
): {
  first: ProtocolState;
  second: ProtocolState;
  sentByFirst: Message[];
  sentBySecond: Message[];
} {
  const queue: { from: "first" | "second"; message: Message }[] = [];
  const sentByFirst: Message[] = [];
  const sentBySecond: Message[] = [];
  const pushMessages = (from: "first" | "second", effects: readonly ProtocolEffect[]) => {
    for (const effect of effects) {
      if (effect.type !== "send") continue;

      queue.push({ from, message: effect.message });
      if (from === "first") sentByFirst.push(effect.message);

      if (from === "second") sentBySecond.push(effect.message);
    }
  };

  let a = first;
  let b = second;
  const openA = stepProtocol(a, { type: "connected", peer: b.self });
  a = openA.state;
  pushMessages("first", openA.effects);

  const openB = stepProtocol(b, { type: "connected", peer: a.self });
  b = openB.state;
  pushMessages("second", openB.effects);

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const raw: unknown = JSON.parse(JSON.stringify(next.message));
    if (next.from === "first") {
      const step = stepProtocol(b, { type: "received", peer: a.self, message: raw });
      b = step.state;
      pushMessages("second", step.effects);
      continue;
    }

    const step = stepProtocol(a, { type: "received", peer: b.self, message: raw });
    a = step.state;
    pushMessages("first", step.effects);
  }

  return { first: a, second: b, sentByFirst, sentBySecond };
}

describe("self-service protocol state machine", () => {
  it("exchanges Hello, Rows and Have on connect and converges", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    const laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const laptopCounterBefore = laptop.counter;
    phone = applyLocalAction(phone, 1_763_200_000_010, renameWork("Office")).state;

    const synced = syncPeers(phone, laptop);
    expect(readPlan(synced.second.rows)).toEqual(readPlan(synced.first.rows));
    // Laptop's merge of phone's change advances laptop's counter without echoing back to phone, so
    // phone's received cursor stays at laptop's counter before that merge.
    expect(synced.first.progress.get(laptopRow.id)).toEqual({
      received: laptopCounterBefore,
      delivered: synced.first.counter,
    });
    expect(synced.second.progress.get(phoneRow.id)).toEqual({
      received: synced.first.counter,
      delivered: laptopCounterBefore,
    });
  });

  it("closes unknown devices and self without Refused, and sends Refused to removed devices", () => {
    const removedTablet: DeviceRow = {
      ...tabletRow,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_050, 0, "phone"),
      },
    };
    const phone = createGroupState(phoneRow.id, [phoneRow, laptopRow, removedTablet]);

    // An unknown key may be a device another member just added before we synced, so close without
    // sending Refused("not-in-group").
    const stranger = stepProtocol(phone, { type: "connected", peer: strangerRow.id });
    expect(stranger.effects).toEqual([{ type: "close", peer: strangerRow.id }]);
    expect(stranger.state.peers.size).toBe(0);

    // An explicitly removed device is told not-in-group before closing.
    const removed = stepProtocol(phone, { type: "connected", peer: removedTablet.id });
    expect(removed.effects).toEqual([
      {
        type: "send",
        peer: removedTablet.id,
        message: { type: "refused", reason: "not-in-group" },
      },
      { type: "close", peer: removedTablet.id },
    ]);
    expect(removed.state.peers.size).toBe(0);

    const selfConnect = stepProtocol(phone, { type: "connected", peer: phoneRow.id });
    expect(selfConnect.effects).toEqual([{ type: "close", peer: phoneRow.id }]);
  });

  it("refuses a Hello from a different group", () => {
    const opened = stepProtocol(createGroupState(phoneRow.id, [phoneRow, laptopRow]), {
      type: "connected",
      peer: laptopRow.id,
    });
    const wrongGroup = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId: otherGroupId,
        counter: 1,
        received: 0,
      },
    });
    expect(wrongGroup.effects).toEqual([
      { type: "send", peer: laptopRow.id, message: { type: "refused", reason: "not-in-group" } },
      { type: "close", peer: laptopRow.id },
    ]);
    expect(wrongGroup.state.peers.has(laptopRow.id)).toBe(false);
  });

  it("sends a full snapshot to a peer that has received nothing yet, even for rows without origins", () => {
    const initialRows = convertPlan(basePlan);
    const rows: Rows = {
      ...initialRows,
      devices: new Map([
        [phoneRow.id, phoneRow],
        [laptopRow.id, laptopRow],
      ]),
    };
    const phone = createProtocolState({
      self: phoneRow.id,
      groupId,
      rows,
      origins: createEmptyOrigins(),
      counter: NO_CHANGE,
    });
    const opened = stepProtocol(phone, { type: "connected", peer: laptopRow.id });
    const afterHello = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 0,
        received: 0,
      },
    });
    expect(findSent(afterHello.effects, laptopRow.id)).toEqual([
      { type: "rows", change: takeSnapshot(rows), upTo: NO_CHANGE },
    ]);
  });

  it("doesn't echo rows back to the sender, but forwards them to a third connected device", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow, tabletRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow, tabletRow]);
    let tablet = createGroupState(tabletRow.id, [phoneRow, laptopRow, tabletRow]);

    // Sync phone <-> laptop and laptop <-> tablet initially so all three start in step.
    const firstSync = syncPeers(phone, laptop);
    phone = firstSync.first;
    laptop = firstSync.second;
    const secondSync = syncPeers(laptop, tablet);
    laptop = secondSync.first;
    tablet = secondSync.second;

    // Phone makes a new edit while connected to laptop, which is also connected to tablet.
    const edit = applyLocalAction(phone, 1_763_200_000_050, (shown) => ({
      ...shown,
      blocks: shown.blocks.map((block) => ({ ...block, start: createBlock({ start: 60 }).start })),
    }));
    phone = edit.state;
    const rowsFromPhone = findSent(edit.effects, laptopRow.id);
    expect(rowsFromPhone).toHaveLength(1);

    const onLaptop = stepProtocol(laptop, {
      type: "received",
      peer: phoneRow.id,
      message: rowsFromPhone[0],
    });
    // Laptop sends Have (and NO Rows) back to phone, and forwards Rows to tablet.
    expect(findSent(onLaptop.effects, phoneRow.id)).toEqual([
      { type: "have", received: phone.counter },
    ]);
    const forwardedToTablet = findSent(onLaptop.effects, tabletRow.id);
    expect(forwardedToTablet).toHaveLength(1);
    expect(forwardedToTablet[0]?.type).toBe("rows");
    expect(onLaptop.effects.some((effect) => effect.type === "persist-merge")).toBe(true);
  });

  it("sends a mixed-register merged row back to the sender so both sides converge", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const initial = syncPeers(phone, laptop);
    phone = stepProtocol(initial.first, { type: "disconnected", peer: laptopRow.id }).state;
    laptop = stepProtocol(initial.second, { type: "disconnected", peer: phoneRow.id }).state;

    // Concurrent edits to different registers of the same activity ("work").
    phone = applyLocalAction(phone, 1_763_200_000_100, recolorWork).state;
    laptop = applyLocalAction(laptop, 1_763_200_000_105, renameWork("Job")).state;

    const synced = syncPeers(phone, laptop);
    expect(readPlan(synced.first.rows)).toEqual(readPlan(synced.second.rows));
    const work = readPlan(synced.first.rows).activities.find((activity) => activity.id === "work");
    expect(work).toMatchObject({ name: "Job", hue: 152 });
  });

  it("recovers both sides when a device is restored from an older copy", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const synced = syncPeers(phone, laptop);
    phone = stepProtocol(synced.first, { type: "disconnected", peer: laptopRow.id }).state;
    laptop = stepProtocol(synced.second, { type: "disconnected", peer: phoneRow.id }).state;

    // Save an older copy of laptop before it makes more edits.
    const oldLaptopCopy = laptop;

    laptop = applyLocalAction(laptop, 1_763_200_000_200, (shown) => ({
      ...shown,
      activities: [...shown.activities, createActivity({ id: "swim", name: "Swim" })],
    })).state;
    laptop = applyLocalAction(laptop, 1_763_200_000_210, (shown) => ({
      ...shown,
      activities: [...shown.activities, createActivity({ id: "cook", name: "Cook" })],
    })).state;

    // Sync laptop's new activities to phone, then restore laptop to its older copy.
    const beforeRestore = syncPeers(phone, laptop);
    phone = stepProtocol(beforeRestore.first, { type: "disconnected", peer: laptopRow.id }).state;

    const afterRestore = syncPeers(phone, oldLaptopCopy);
    // Restored laptop recovers "swim" and "cook" from phone even though phone originally got them
    // from laptop, and phone's received cursor resets to what laptop actually sent.
    expect(readPlan(afterRestore.second.rows)).toEqual(readPlan(afterRestore.first.rows));
    expect(readPlan(afterRestore.second.rows).activities.map((activity) => activity.id)).toContain(
      "swim",
    );
    expect(readPlan(afterRestore.second.rows).activities.map((activity) => activity.id)).toContain(
      "cook",
    );
    expect(afterRestore.first.progress.get(laptopRow.id)?.received).toBe(oldLaptopCopy.counter);
    expect(afterRestore.second.progress.get(phoneRow.id)?.received).toBe(
      afterRestore.first.counter,
    );
  });

  it("detects an outlived peer even when local counter advances while Hello is in flight", () => {
    const base = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let phone = createProtocolState({
      self: base.self,
      groupId,
      rows: base.rows,
      origins: base.origins,
      counter: base.counter,
      progress: new Map([
        [laptopRow.id, { received: createCounter(1), delivered: createCounter(1) }],
      ]),
    });
    // Phone opens a connection at counter 1, then makes a local edit (counter 2) before laptop's
    // Hello arrives claiming received: 2 from an earlier history before phone was restored.
    phone = stepProtocol(phone, { type: "connected", peer: laptopRow.id }).state;
    phone = applyLocalAction(phone, 1_763_200_000_250, renameWork("Studio")).state;

    const afterHello = stepProtocol(phone, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 2,
        received: 2,
      },
    });
    expect(afterHello.state.progress.get(laptopRow.id)?.delivered).toBe(NO_CHANGE);
    expect(findSent(afterHello.effects, laptopRow.id)).toEqual([
      { type: "rows", change: takeSnapshot(phone.rows), upTo: phone.counter },
    ]);
  });

  it("refuses a removed device and turns syncing off when told not-in-group", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const synced = syncPeers(phone, laptop);
    phone = synced.first;
    laptop = synced.second;

    const removedLaptop: DeviceRow = {
      ...laptopRow,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_300, 0, "phone"),
      },
    };
    const removed = applyDeviceChange(phone, removedLaptop);
    phone = removed.state;
    expect(removed.effects).toEqual([
      { type: "send", peer: laptopRow.id, message: { type: "refused", reason: "not-in-group" } },
      { type: "close", peer: laptopRow.id },
    ]);
    expect(phone.peers.has(laptopRow.id)).toBe(false);

    // Laptop receives Refused("not-in-group"), turns syncing off and keeps its plan.
    const onLaptop = stepProtocol(laptop, {
      type: "received",
      peer: phoneRow.id,
      message: { type: "refused", reason: "not-in-group" },
    });
    expect(onLaptop.state.status).toBe("removed");
    expect(onLaptop.state.peers.size).toBe(0);
    expect(onLaptop.effects).toEqual([
      { type: "close", peer: phoneRow.id },
      { type: "sync-disabled", reason: "removed" },
    ]);
    expect(readPlan(onLaptop.state.rows)).toEqual(readPlan(laptop.rows));

    // A removed device ignores later connections and local edits without sending anything.
    expect(stepProtocol(onLaptop.state, { type: "connected", peer: phoneRow.id }).effects).toEqual([
      { type: "close", peer: phoneRow.id },
    ]);
  });

  it("turns syncing off when a merged Rows removes this device itself", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const synced = syncPeers(phone, laptop);
    phone = synced.first;
    laptop = synced.second;

    const removedLaptop: DeviceRow = {
      ...laptopRow,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_300, 0, "phone"),
      },
    };
    const change = { ...takeSnapshot(phone.rows), devices: [phoneRow, removedLaptop] };
    const step = stepProtocol(laptop, {
      type: "received",
      peer: phoneRow.id,
      message: { type: "rows", change, upTo: phone.counter + 1 },
    });
    expect(step.state.status).toBe("removed");
    expect(step.effects).toContainEqual({ type: "close", peer: phoneRow.id });
    expect(step.effects).toContainEqual({ type: "sync-disabled", reason: "removed" });
    expect(step.effects.some((effect) => effect.type === "persist-merge")).toBe(true);
  });

  it("stops syncing with a peer and requests reload on newer protocol or change version", () => {
    const opened = stepProtocol(createGroupState(phoneRow.id, [phoneRow, laptopRow]), {
      type: "connected",
      peer: laptopRow.id,
    });
    const newerHello = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "hello", version: PROTOCOL_VERSION + 1 },
    });
    expect(newerHello.effects).toEqual([
      { type: "reload-needed" },
      { type: "close", peer: laptopRow.id },
    ]);
    expect(newerHello.state.status).toBe("active");

    const refusedNewer = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "refused", reason: "newer-version" },
    });
    expect(refusedNewer.effects).toEqual([
      { type: "reload-needed" },
      { type: "close", peer: laptopRow.id },
    ]);
    expect(refusedNewer.state.status).toBe("active");
  });

  it("closes on protocol violations without advancing progress or merging", () => {
    const opened = stepProtocol(createGroupState(phoneRow.id, [phoneRow, laptopRow]), {
      type: "connected",
      peer: laptopRow.id,
    });

    // Rows before Hello
    const earlyRows = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "rows", change: takeSnapshot(opened.state.rows), upTo: 5 },
    });
    expect(earlyRows.effects).toEqual([{ type: "close", peer: laptopRow.id }]);
    expect(earlyRows.state.progress.get(laptopRow.id)).toBeUndefined();

    // Have before Hello
    const earlyHave = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "have", received: 1 },
    });
    expect(earlyHave.effects).toEqual([{ type: "close", peer: laptopRow.id }]);

    // Malformed message
    const malformed = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "have", received: -1 },
    });
    expect(malformed.effects).toEqual([{ type: "close", peer: laptopRow.id }]);

    // Complete handshake, then test duplicate Hello and Have beyond our counter
    const ready = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 1,
        received: 1,
      },
    }).state;

    expect(
      stepProtocol(ready, {
        type: "received",
        peer: laptopRow.id,
        message: {
          type: "hello",
          version: PROTOCOL_VERSION,
          groupId,
          counter: 1,
          received: 1,
        },
      }).effects,
    ).toEqual([{ type: "close", peer: laptopRow.id }]);

    const impossibleHave = stepProtocol(ready, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "have", received: ready.counter + 1 },
    });
    expect(impossibleHave.effects).toEqual([{ type: "close", peer: laptopRow.id }]);
    expect(impossibleHave.state.progress.get(laptopRow.id)?.delivered).toBe(1);
  });

  it("removes a peer on disconnect and ignores later messages from it", () => {
    const phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    const opened = stepProtocol(phone, { type: "connected", peer: laptopRow.id });
    expect(opened.state.peers.has(laptopRow.id)).toBe(true);

    const closed = stepProtocol(opened.state, { type: "disconnected", peer: laptopRow.id });
    expect(closed.effects).toEqual([]);
    expect(closed.state.peers.has(laptopRow.id)).toBe(false);

    const afterClose = stepProtocol(closed.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: 1,
        received: 1,
      },
    });
    expect(afterClose.effects).toEqual([]);
  });

  it("ignores messages and disconnects for peers without an open connection", () => {
    const phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    expect(stepProtocol(phone, { type: "disconnected", peer: laptopRow.id }).effects).toEqual([]);
    expect(
      stepProtocol(phone, {
        type: "received",
        peer: laptopRow.id,
        message: { type: "have", received: 0 },
      }).effects,
    ).toEqual([]);
  });

  it("persists only changed rows (including settings-only edits) and emits persist-progress", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const synced = syncPeers(phone, laptop);
    phone = synced.first;
    laptop = synced.second;

    const edit = applyLocalAction(phone, 1_763_200_000_400, (shown) => ({
      ...shown,
      dayStart: sanitizeDayStart(8),
    }));
    phone = edit.state;
    const sent = findSent(edit.effects, laptopRow.id);
    expect(sent).toHaveLength(1);

    const merged = stepProtocol(laptop, {
      type: "received",
      peer: phoneRow.id,
      message: sent[0],
    });
    expect(merged.effects).toContainEqual({
      type: "persist-merge",
      rows: merged.state.rows,
      written: {
        version: 1,
        activities: [],
        blocks: [],
        settings: merged.state.rows.settings,
        devices: [],
      },
      origins: merged.state.origins,
      counter: merged.state.counter,
      latestStamp: merged.state.rows.settings.dayStart.stamp,
      sender: phoneRow.id,
    });
    expect(merged.effects).toContainEqual({
      type: "persist-progress",
      peer: phoneRow.id,
      progress: { received: phone.counter, delivered: createCounter(1) },
    });

    const haveOnPhone = stepProtocol(phone, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "have", received: phone.counter },
    });
    expect(haveOnPhone.effects).toEqual([
      {
        type: "persist-progress",
        peer: laptopRow.id,
        progress: { received: createCounter(1), delivered: phone.counter },
      },
    ]);
  });

  it("sends nothing on reconnect when already in step, and only new changes when ahead", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    const initial = syncPeers(phone, laptop);
    phone = stepProtocol(initial.first, { type: "disconnected", peer: laptopRow.id }).state;
    laptop = stepProtocol(initial.second, { type: "disconnected", peer: phoneRow.id }).state;

    // Reconnecting in step emits neither Rows nor persist-progress.
    const opened = stepProtocol(phone, { type: "connected", peer: laptopRow.id });
    const inStep = stepProtocol(opened.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: laptop.counter,
        received: phone.counter,
      },
    });
    expect(inStep.effects).toEqual([]);

    // Disconnecting, making two edits, and reconnecting with received: 2 sends only the newer
    // edit and persists the advanced delivered cursor from Hello.
    phone = stepProtocol(inStep.state, { type: "disconnected", peer: laptopRow.id }).state;
    phone = applyLocalAction(phone, 1_763_200_000_500, renameWork("Desk")).state;
    const workId = createActivity({ id: "work" }).id;
    const reopened = stepProtocol(phone, { type: "connected", peer: laptopRow.id });
    const afterDeltaHello = stepProtocol(reopened.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: laptop.counter,
        received: createCounter(1),
      },
    });
    expect(afterDeltaHello.effects).toEqual([
      {
        type: "send",
        peer: laptopRow.id,
        message: {
          type: "rows",
          change: {
            version: 1,
            activities: [phone.rows.activities.get(workId)],
            blocks: [],
            settings: null,
            devices: [],
          },
          upTo: phone.counter,
        },
      },
    ]);

    // When a peer's Hello reports a higher received cursor than our stored delivered, persist it.
    const behindPhone = stepProtocol(
      createProtocolState({
        self: phone.self,
        groupId,
        rows: phone.rows,
        origins: phone.origins,
        counter: phone.counter,
        progress: new Map([[laptopRow.id, { received: laptop.counter, delivered: NO_CHANGE }]]),
      }),
      { type: "connected", peer: laptopRow.id },
    );
    const persisted = stepProtocol(behindPhone.state, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: laptop.counter,
        received: phone.counter,
      },
    });
    expect(persisted.effects).toEqual([
      {
        type: "persist-progress",
        peer: laptopRow.id,
        progress: { received: laptop.counter, delivered: phone.counter },
      },
    ]);
  });

  it("ignores older or duplicate Have and Rows cursors without regressing progress", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    phone = applyLocalAction(phone, 1_763_200_000_510, renameWork("Desk")).state;
    const synced = syncPeers(phone, laptop);
    phone = synced.first;
    laptop = synced.second;

    // Older Have must not lower delivered or emit persist-progress.
    const olderHave = stepProtocol(phone, {
      type: "received",
      peer: laptopRow.id,
      message: { type: "have", received: 1 },
    });
    expect(olderHave.effects).toEqual([]);
    expect(olderHave.state.progress.get(laptopRow.id)?.delivered).toBe(phone.counter);

    // Duplicate Rows with an older upTo must not lower received or emit persist-progress.
    const duplicateRows = stepProtocol(laptop, {
      type: "received",
      peer: phoneRow.id,
      message: { type: "rows", change: takeSnapshot(phone.rows), upTo: 1 },
    });
    expect(duplicateRows.state.progress.get(phoneRow.id)?.received).toBe(phone.counter);
    expect(duplicateRows.effects).toEqual([
      { type: "send", peer: phoneRow.id, message: { type: "have", received: phone.counter } },
    ]);
  });

  it("waits for Hello before pushing local edits, and does not re-send earlier edits once sent", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    let laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);

    // While laptop is still awaiting-hello, local edits must not push Rows to it yet.
    const awaiting = stepProtocol(phone, { type: "connected", peer: laptopRow.id });
    const editWhileAwaiting = applyLocalAction(
      awaiting.state,
      1_763_200_000_600,
      renameWork("First"),
    );
    expect(editWhileAwaiting.effects).toEqual([]);

    // Sync to ready, then make two consecutive edits: the second must only send the second edit.
    const synced = syncPeers(editWhileAwaiting.state, laptop);
    phone = synced.first;
    laptop = synced.second;

    const firstEdit = applyLocalAction(phone, 1_763_200_000_610, renameWork("Second"));
    expect(findSent(firstEdit.effects, laptopRow.id)).toHaveLength(1);

    const secondEdit = applyLocalAction(firstEdit.state, 1_763_200_000_620, (shown) => ({
      ...shown,
      dayStart: sanitizeDayStart(9),
    }));
    expect(findSent(secondEdit.effects, laptopRow.id)).toEqual([
      {
        type: "rows",
        change: {
          version: 1,
          activities: [],
          blocks: [],
          settings: secondEdit.state.rows.settings,
          devices: [],
        },
        upTo: secondEdit.state.counter,
      },
    ]);
  });

  it("turns syncing off on a local change that removes self, and ignores later local edits", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    const laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    phone = syncPeers(phone, laptop).first;

    const removedSelf: DeviceRow = {
      ...phoneRow,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_700, 0, "phone"),
      },
    };
    const stopped = applyDeviceChange(phone, removedSelf);
    expect(stopped.state.status).toBe("removed");
    expect(stopped.state.peers.size).toBe(0);
    expect(stopped.effects).toEqual([
      { type: "close", peer: laptopRow.id },
      { type: "sync-disabled", reason: "removed" },
    ]);

    const afterRemoved = applyLocalAction(stopped.state, 1_763_200_000_710, renameWork("Solo"));
    expect(afterRemoved.effects).toEqual([]);
    expect(readPlan(afterRemoved.state.rows).activities[0]?.name).toBe("Solo");
  });

  it("refuses the sender without sending Have when merged Rows marks the sender removed", () => {
    let phone = createGroupState(phoneRow.id, [phoneRow, laptopRow]);
    const laptop = createGroupState(laptopRow.id, [phoneRow, laptopRow]);
    phone = syncPeers(phone, laptop).first;

    const removedLaptop: DeviceRow = {
      ...laptopRow,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_800, 0, "laptop"),
      },
    };
    const step = stepProtocol(phone, {
      type: "received",
      peer: laptopRow.id,
      message: {
        type: "rows",
        change: { ...takeSnapshot(phone.rows), devices: [phoneRow, removedLaptop] },
        upTo: laptop.counter + 1,
      },
    });
    expect(findSent(step.effects, laptopRow.id)).toEqual([
      { type: "refused", reason: "not-in-group" },
    ]);
    expect(step.effects).toContainEqual({ type: "close", peer: laptopRow.id });
    expect(step.state.peers.has(laptopRow.id)).toBe(false);
  });

  it("starts in removed status when storage already marks this device removed", () => {
    const removedSelf: DeviceRow = {
      ...phoneRow,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_100, 0, "laptop"),
      },
    };
    const state = createGroupState(phoneRow.id, [removedSelf, laptopRow]);
    expect(state.status).toBe("removed");
    expect(stepProtocol(state, { type: "connected", peer: laptopRow.id }).effects).toEqual([
      { type: "close", peer: laptopRow.id },
    ]);
  });

  it("syncs with a temporary device and accepts initial progress from storage", () => {
    const temporaryWindow: DeviceRow = {
      ...tabletRow,
      membership: {
        value: { status: "temporary", proof: null },
        stamp: createStamp(1_763_200_000_000, 0, "phone"),
      },
    };
    const base = createGroupState(phoneRow.id, [phoneRow, temporaryWindow]);
    const resumed = createProtocolState({
      self: base.self,
      groupId,
      rows: base.rows,
      origins: base.origins,
      counter: base.counter,
      progress: new Map([[temporaryWindow.id, { received: NO_CHANGE, delivered: NO_CHANGE }]]),
    });
    const opened = stepProtocol(resumed, { type: "connected", peer: temporaryWindow.id });
    expect(findSent(opened.effects, temporaryWindow.id)).toEqual([
      {
        type: "hello",
        version: PROTOCOL_VERSION,
        groupId,
        counter: resumed.counter,
        received: NO_CHANGE,
      },
    ]);
  });
});
