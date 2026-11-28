import { describe, expect, it } from "vitest";

import type { DeviceKey } from "../device/index.ts";
import { make } from "../merge/change.ts";
import { convertPlan, merge, takeSnapshot, type Change, type Rows } from "../merge/index.ts";
import { parseDeviceName } from "../device/index.ts";
import type { DeviceRow } from "../merge/row.ts";
import { createDevice, createStamp, requireValue } from "../merge/test-data.ts";
import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createActivity, createBlock } from "../plan/test-data.ts";
import { sanitizeDayEnd, sanitizeDayStart } from "../plan/time.ts";
import {
  NO_CHANGE,
  collectSince,
  createEmptyOrigins,
  findLatestChange,
  incrementChangeNumber,
  noteAction,
  noteMerge,
  parseChangeNumber,
  type ChangeNumber,
  type Origins,
} from "./origin.ts";

function createChangeNumber(value: number): ChangeNumber {
  const number = parseChangeNumber(value);
  if (number === "out-of-range")
    throw new Error(`The test has an invalid counter: ${String(value)}.`);

  return number;
}

const phone = createDevice("a").id;
const laptop = createDevice("b").id;
const tablet = createDevice("c").id;

const plan: Plan = {
  ...createEmptyPlan(),
  activities: [createActivity({ id: "work", name: "Work" }), createActivity({ id: "gym" })],
  blocks: [
    createBlock({ id: "1", activityId: "work" }),
    createBlock({ id: "2", activityId: "gym" }),
  ],
};

/** A device with rows, their origins and its counter, as the leader tab will hold them. */
type Device = { key: DeviceKey; rows: Rows; origins: Origins; counter: ChangeNumber };

const createTestDevice = (key: DeviceKey, rows: Rows): Device => ({
  key,
  rows,
  origins: createEmptyOrigins(),
  counter: NO_CHANGE,
});

function advanceCounter(device: Device): ChangeNumber {
  const number = incrementChangeNumber(device.counter);
  if (number === "out-of-range") throw new Error("The test's counter is at its highest.");

  return number;
}

/** Makes the device do one action with the stamp at `time`, and notes it. */
function act(device: Device, time: number, perform: (shown: Plan) => Plan): void {
  const made = make(device.rows, perform, createStamp(time, 0, device.key.slice(0, 8)));
  const counter = advanceCounter(device);
  device.origins = noteAction(device.rows, made.rows, device.origins, counter);
  device.rows = made.rows;
  device.counter = counter;
}

/** Makes `receiver` merge what `sender` owes it, from where it has the sender's changes. */
function sync(sender: Device, receiver: Device, since: ChangeNumber = NO_CHANGE): Change {
  const change = collectSince(sender.rows, sender.origins, since, receiver.key);
  const merged = merge(receiver.rows, change);
  const counter = advanceCounter(receiver);
  receiver.origins = noteMerge(
    receiver.rows,
    merged,
    change,
    receiver.origins,
    counter,
    sender.key,
  );
  receiver.rows = merged;
  receiver.counter = counter;
  return change;
}

const moveBlock = (id: string, start: number) => (shown: Plan) => ({
  ...shown,
  blocks: shown.blocks.map((block) =>
    block.id === id ? { ...block, start: createBlock({ start }).start } : block,
  ),
});

const renameWork = (name: string) => (shown: Plan) => ({
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

const listIds = (change: Change) => ({
  activities: change.activities.map((row) => row.id),
  blocks: change.blocks.map((row) => row.id),
  settings: change.settings !== null,
  devices: change.devices.map((row) => row.id),
});

describe("the counter's values", () => {
  it("are whole numbers from 0 that JavaScript holds exactly", () => {
    expect(parseChangeNumber(0)).toBe(0);
    expect(parseChangeNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseChangeNumber(-1)).toBe("out-of-range");
    expect(parseChangeNumber(1.5)).toBe("out-of-range");
    expect(parseChangeNumber(Number.NaN)).toBe("out-of-range");
    expect(incrementChangeNumber(createChangeNumber(Number.MAX_SAFE_INTEGER))).toBe("out-of-range");
  });
});

/** This device's own change at `changedAt`. */
const createOriginAt = (changedAt: number) => ({
  changedAt: createChangeNumber(changedAt),
  changedBy: null,
});

describe("the latest change among the rows", () => {
  it("is the highest number any row was changed at, of any kind", () => {
    expect(findLatestChange(createEmptyOrigins())).toBe(0);
    const origins: Origins = {
      activities: new Map([[requireValue(plan.activities[0], "activity").id, createOriginAt(2)]]),
      blocks: new Map([[requireValue(plan.blocks[0], "block").id, createOriginAt(5)]]),
      settings: createOriginAt(3),
      devices: new Map([[phone, createOriginAt(4)]]),
    };
    expect(findLatestChange(origins)).toBe(5);
    expect(findLatestChange({ ...origins, blocks: new Map() })).toBe(4);
    expect(findLatestChange({ ...origins, blocks: new Map(), devices: new Map() })).toBe(3);
    expect(findLatestChange({ ...origins, settings: createOriginAt(7) })).toBe(7);
  });
});

describe("noting an action", () => {
  it("gives the rows it wrote the counter's next value, as this device's own", () => {
    const device = createTestDevice(phone, convertPlan(plan));
    act(device, 1_763_200_000_000, (shown) => shown);
    act(device, 1_763_200_000_001, moveBlock("1", 0));
    const one = { changedAt: 2, changedBy: null };
    expect([...device.origins.blocks]).toEqual([["1", one]]);
    expect(device.origins.activities.size).toBe(0);
    expect(device.origins.settings).toEqual({ changedAt: 0, changedBy: null });
    act(device, 1_763_200_000_002, (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }));
    expect(device.origins.settings).toEqual({ changedAt: 3, changedBy: null });
    expect(device.origins.blocks.get(requireValue(plan.blocks[0], "block").id)).toEqual(one);
  });
});

describe("noting a merge", () => {
  it("notes a row that came out as the sender's version as the sender's", () => {
    const sender = createTestDevice(phone, convertPlan(plan));
    const receiver = createTestDevice(laptop, convertPlan(plan));
    act(sender, 1_763_200_000_000, moveBlock("1", 0));
    sync(sender, receiver);
    expect([...receiver.origins.blocks]).toEqual([["1", { changedAt: 1, changedBy: phone }]]);
    // Work came along with its block, the same as the laptop holds it, so nothing was written.
    expect(receiver.origins.activities.size).toBe(0);
  });

  it("notes a row that came out as neither side's as this device's own, so it goes to everyone", () => {
    const sender = createTestDevice(phone, convertPlan(plan));
    const receiver = createTestDevice(laptop, convertPlan(plan));
    // The phone changes Work's hue, and the laptop renames it: each wins its own register.
    act(sender, 1_763_200_000_000, recolorWork);
    act(receiver, 1_763_200_000_005, renameWork("Job"));
    sync(sender, receiver);
    const work = requireValue(plan.activities[0], "activity").id;
    expect(receiver.origins.activities.get(work)).toEqual({ changedAt: 2, changedBy: null });
    expect(receiver.rows.activities.get(work)).toMatchObject({
      name: { value: "Job" },
      hue: { value: 152 },
    });
    // So the phone gets it back, though it sent part of it.
    expect(
      listIds(collectSince(receiver.rows, receiver.origins, NO_CHANGE, phone)).activities,
    ).toEqual(["work"]);
  });

  it("leaves a row the merge didn't alter as it was", () => {
    const sender = createTestDevice(phone, convertPlan(plan));
    const receiver = createTestDevice(laptop, convertPlan(plan));
    act(receiver, 1_763_200_000_005, renameWork("Job"));
    act(sender, 1_763_200_000_000, renameWork("Office"));
    sync(sender, receiver);
    // The laptop's later name wins, so its row stays its own change 1.
    const work = requireValue(plan.activities[0], "activity").id;
    expect(receiver.origins.activities.get(work)).toEqual({ changedAt: 1, changedBy: null });
  });

  it("notes settings and a device that came out as neither side's as this device's own", () => {
    const sender = createTestDevice(phone, convertPlan(plan));
    const receiver = createTestDevice(laptop, convertPlan(plan));
    act(sender, 1_763_200_000_000, (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }));
    act(receiver, 1_763_200_000_005, (shown) => ({ ...shown, dayEnd: sanitizeDayEnd(20) }));
    const device = createDevice("d", createStamp(1_763_200_000_000, 0, "phone"));
    const renamedHere: DeviceRow = {
      ...device,
      name: {
        value: requireValue(parseDeviceName("Tablet"), "name"),
        stamp: createStamp(1_763_200_000_005, 0, "laptop"),
      },
    };
    const removedThere: DeviceRow = {
      ...device,
      membership: {
        value: { status: "removed", proof: null },
        stamp: createStamp(1_763_200_000_001, 0, "phone"),
      },
    };
    const held = { ...receiver.rows, devices: new Map([[device.id, renamedHere]]) };
    const change = { ...takeSnapshot(sender.rows), devices: [removedThere] };
    const merged = merge(held, change);
    const origins = noteMerge(held, merged, change, receiver.origins, createChangeNumber(4), phone);
    expect(merged.settings).toMatchObject({ dayStart: { value: 6 }, dayEnd: { value: 20 } });
    expect(origins.settings).toEqual({ changedAt: 4, changedBy: null });
    expect(origins.devices.get(device.id)).toEqual({ changedAt: 4, changedBy: null });
  });

  it("leaves a device the merge didn't alter as it was", () => {
    const device = createDevice("d", createStamp(1_763_200_000_000, 0, "phone"));
    const rows = { ...convertPlan(plan), devices: new Map([[device.id, device]]) };
    const origins = {
      ...createEmptyOrigins(),
      devices: new Map([[device.id, { changedAt: createChangeNumber(1), changedBy: null }]]),
    };
    const change = { ...takeSnapshot(rows), devices: [createDevice("d")] };
    const noted = noteMerge(
      rows,
      merge(rows, change),
      change,
      origins,
      createChangeNumber(2),
      phone,
    );
    expect(noted.devices.get(device.id)).toEqual({ changedAt: 1, changedBy: null });
  });

  it("notes settings and devices the same way", () => {
    const sender = createTestDevice(phone, convertPlan(plan));
    const receiver = createTestDevice(laptop, convertPlan(plan));
    const device = createDevice("d", createStamp(1_763_200_000_000, 0, "phone"));
    act(sender, 1_763_200_000_000, (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }));
    const change = { ...takeSnapshot(sender.rows), devices: [device] };
    const merged = merge(receiver.rows, change);
    const origins = noteMerge(
      receiver.rows,
      merged,
      change,
      receiver.origins,
      createChangeNumber(4),
      phone,
    );
    expect(origins.settings).toEqual({ changedAt: 4, changedBy: phone });
    expect(origins.devices.get(device.id)).toEqual({ changedAt: 4, changedBy: phone });
  });
});

describe("collecting what another device hasn't got", () => {
  it("gives every row that changed after the point it has, as it is now", () => {
    const device = createTestDevice(phone, convertPlan(plan));
    act(device, 1_763_200_000_000, moveBlock("1", 0));
    act(device, 1_763_200_000_001, (shown) => ({ ...shown, dayStart: sanitizeDayStart(6) }));
    act(device, 1_763_200_000_002, moveBlock("1", 60));
    expect(listIds(collectSince(device.rows, device.origins, NO_CHANGE, laptop))).toEqual({
      activities: ["work"],
      blocks: ["1"],
      settings: true,
      devices: [],
    });
    expect(
      listIds(collectSince(device.rows, device.origins, createChangeNumber(2), laptop)),
    ).toEqual({
      activities: ["work"],
      blocks: ["1"],
      settings: false,
      devices: [],
    });
    expect(
      listIds(collectSince(device.rows, device.origins, createChangeNumber(3), laptop)),
    ).toEqual({
      activities: [],
      blocks: [],
      settings: false,
      devices: [],
    });
    const [block] = collectSince(device.rows, device.origins, createChangeNumber(2), laptop).blocks;
    expect(block?.time.value.start).toBe(60);
  });

  it("brings each block's activity along, though the activity didn't change", () => {
    const device = createTestDevice(phone, convertPlan(plan));
    act(device, 1_763_200_000_000, moveBlock("2", 0));
    expect(
      listIds(collectSince(device.rows, device.origins, NO_CHANGE, laptop)).activities,
    ).toEqual(["gym"]);
  });

  it("doesn't send a row back to the device it came from, but passes it on to the others", () => {
    const phoneDevice = createTestDevice(phone, convertPlan(plan));
    const laptopDevice = createTestDevice(laptop, convertPlan(plan));
    const tabletDevice = createTestDevice(tablet, convertPlan(plan));
    act(phoneDevice, 1_763_200_000_000, moveBlock("1", 0));
    sync(phoneDevice, laptopDevice);
    expect(
      listIds(collectSince(laptopDevice.rows, laptopDevice.origins, NO_CHANGE, phone)),
    ).toEqual({
      activities: [],
      blocks: [],
      settings: false,
      devices: [],
    });
    sync(laptopDevice, tabletDevice);
    const block = requireValue(plan.blocks[0], "block").id;
    expect(tabletDevice.rows.blocks.get(block)?.time.value.start).toBe(0);
    expect(tabletDevice.origins.blocks.get(block)).toEqual({ changedAt: 1, changedBy: laptop });
  });

  it("sorts what it gives by id", () => {
    const device = createTestDevice(phone, convertPlan(plan));
    act(device, 1_763_200_000_000, (shown) => ({
      ...shown,
      blocks: shown.blocks.map((block) => ({ ...block, start: createBlock({ start: 0 }).start })),
    }));
    const later = createDevice("e");
    const earlier = createDevice("1");
    const rows = {
      ...device.rows,
      devices: new Map([
        [later.id, later],
        [earlier.id, earlier],
      ]),
    };
    const origins = noteAction(device.rows, rows, device.origins, createChangeNumber(2));
    expect(listIds(collectSince(rows, origins, NO_CHANGE, laptop))).toEqual({
      activities: ["gym", "work"],
      blocks: ["1", "2"],
      settings: false,
      devices: [earlier.id, later.id],
    });
  });

  it("throws on a block whose activity has no row, which the rows never hold", () => {
    const device = createTestDevice(phone, convertPlan(plan));
    act(device, 1_763_200_000_000, moveBlock("1", 0));
    const rows = { ...device.rows, activities: new Map() };
    expect(() => collectSince(rows, device.origins, NO_CHANGE, laptop)).toThrow(/has no row/u);
  });

  it("includes the device list", () => {
    const device = createTestDevice(phone, convertPlan(plan));
    const added = createDevice("d", createStamp(1_763_200_000_000, 0, "phone"));
    const rows = { ...device.rows, devices: new Map([[added.id, added]]) };
    const origins = noteAction(device.rows, rows, device.origins, createChangeNumber(1));
    expect(listIds(collectSince(rows, origins, NO_CHANGE, laptop)).devices).toEqual([added.id]);
  });
});
