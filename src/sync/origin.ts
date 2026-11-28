// What a device keeps for syncing beside its rows (see What a device keeps for syncing in
// docs/spec/self-service.md): a counter that numbers every write to its rows, by its own action or
// by a merge, and for each row the number of its last change and which device that change came
// from. From these it finds what another device hasn't got: every row that changed after the point
// the other says it has, except the rows the other sent itself. Pure, like the merge.
import type { Brand } from "../brand.ts";
import type { DeviceKey } from "../device/index.ts";
import { FORMAT_VERSION, type Change, type Rows } from "../merge/index.ts";
import {
  mergeActivity,
  mergeBlock,
  mergeDevice,
  mergeSettings,
  type ActivityRow,
  type BlockRow,
  type DeviceRow,
  type SettingsRow,
} from "../merge/row.ts";
import type { ActivityId, BlockId } from "../plan/id.ts";
import type { Result } from "../result.ts";

/**
 * A value of a device's counter: a whole number from 0, where 0 is before its first change. It
 * numbers the writes to the device's rows, and says how far one device has another's changes.
 */
export type ChangeNumber = Brand<number, "ChangeNumber">;

/**
 * Gives a checked number its brand. Only the functions below call it, with a number they've just
 * checked, so this is the one type assertion in the module.
 */
function brand(value: number): ChangeNumber {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked number becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as ChangeNumber;
}

/** The counter before a device's first change, and how far a device has a new one's changes. */
export const NO_CHANGE: ChangeNumber = brand(0);

/** A whole number from 0 that JavaScript holds exactly, as SQLite's integers and the wire do. */
export const parseChangeNumber = (value: number): Result<ChangeNumber, "out-of-range"> =>
  Number.isSafeInteger(value) && value >= 0 ? brand(value) : "out-of-range";

/** The next value of the counter. A device would need millions of changes a second for ages. */
export const incrementChangeNumber = (value: ChangeNumber): Result<ChangeNumber, "out-of-range"> =>
  parseChangeNumber(value + 1);

/**
 * Where a row's last change came from: the counter's value when it was written here, and the
 * device that sent it, or null when it was this device's own, by an action or by a merge whose
 * result no single other device holds.
 */
export type Origin = { readonly changedAt: ChangeNumber; readonly changedBy: DeviceKey | null };

/** Each row's origin, by the same keys as the rows. A row that was never written has none. */
export type Origins = {
  readonly activities: ReadonlyMap<ActivityId, Origin>;
  readonly blocks: ReadonlyMap<BlockId, Origin>;
  readonly settings: Origin;
  readonly devices: ReadonlyMap<DeviceKey, Origin>;
};

/** The origins of rows that were never written: none, and settings that are older than anything. */
export const createEmptyOrigins = (): Origins => ({
  activities: new Map(),
  blocks: new Map(),
  settings: { changedAt: NO_CHANGE, changedBy: null },
  devices: new Map(),
});

/**
 * The highest number any row was changed at. The counter is never below it, also before the node
 * that holds the counter exists, as in a database migrated before its first save, whose rows count
 * as change 1.
 */
export const findLatestChange = (origins: Origins): ChangeNumber =>
  [origins.activities, origins.blocks, origins.devices]
    .values()
    .flatMap((each) => each.values())
    .reduce(
      (latest, origin) => (origin.changedAt > latest ? origin.changedAt : latest),
      origins.settings.changedAt,
    );

/** Rows by their ids. */
const collectById = <Key, Row extends { id: Key }>(rows: readonly Row[]): Map<Key, Row> =>
  new Map(rows.values().map((row) => [row.id, row]));

/** Rows sorted by id, so the same rows always give the same change. */
const sortById = <Row extends { id: string }>(rows: Map<string, Row>): Row[] =>
  rows
    .values()
    .toArray()
    .toSorted((first, second) => (first.id < second.id ? -1 : 1));

/**
 * The origins after a write: each row the write replaced, by identity, gets one from `findOrigin`.
 * The merge keeps a row it didn't alter as the same object, so identity finds the written ones.
 */
function noteWritten<Key, Row>(
  before: ReadonlyMap<Key, Row>,
  after: ReadonlyMap<Key, Row>,
  origins: ReadonlyMap<Key, Origin>,
  findOrigin: (key: Key, row: Row) => Origin,
): Map<Key, Origin> {
  const noted = new Map(origins);
  for (const [key, row] of after) {
    if (before.get(key) !== row) noted.set(key, findOrigin(key, row));
  }

  return noted;
}

/**
 * Notes one action of this device's: every row it wrote changed here, at `changedAt`.
 *
 * @param before - The rows before the action.
 * @param after - The rows after it, from `make()`.
 * @param origins - The origins before it.
 * @param changedAt - The counter's next value, which this write takes.
 */
export function noteAction(
  before: Rows,
  after: Rows,
  origins: Origins,
  changedAt: ChangeNumber,
): Origins {
  const origin: Origin = { changedAt, changedBy: null };
  const findOrigin = (): Origin => origin;
  return {
    activities: noteWritten(before.activities, after.activities, origins.activities, findOrigin),
    blocks: noteWritten(before.blocks, after.blocks, origins.blocks, findOrigin),
    settings: before.settings === after.settings ? origins.settings : origin,
    devices: noteWritten(before.devices, after.devices, origins.devices, findOrigin),
  };
}

/**
 * Notes a merge of rows another device sent. A row that came out as the sender's version came from
 * it, so it isn't sent back there. A row that came out as neither side's, some registers from each,
 * is a version only this device has, so it counts as this device's own and goes to everyone.
 *
 * @param before - The rows before the merge.
 * @param after - The rows after it, from `merge()`.
 * @param change - What the device sent, checked strictly.
 * @param origins - The origins before the merge.
 * @param changedAt - The counter's next value, which this write takes.
 * @param sender - The device that sent the change.
 */
export function noteMerge(
  before: Rows,
  after: Rows,
  change: Change,
  origins: Origins,
  changedAt: ChangeNumber,
  sender: DeviceKey,
): Origins {
  /**
   * The origin of a row the merge wrote: the sender's when the row is its version. Merging a row
   * into the sender's gives back the sender's own object exactly when every register is the same
   * (see `register.merge`), so the row's merge function tells.
   */
  const findOrigin =
    <Key, Row>(received: ReadonlyMap<Key, Row>, mergeRow: (first: Row, second: Row) => Row) =>
    (key: Key, row: Row): Origin => {
      const sent = received.get(key);
      const isSenders = sent !== undefined && mergeRow(sent, row) === sent;
      return { changedAt, changedBy: isSenders ? sender : null };
    };
  const findSettingsOrigin = (): Origin => {
    if (before.settings === after.settings) return origins.settings;

    const isSenders =
      change.settings !== null &&
      mergeSettings(change.settings, after.settings) === change.settings;
    return { changedAt, changedBy: isSenders ? sender : null };
  };

  return {
    activities: noteWritten(
      before.activities,
      after.activities,
      origins.activities,
      findOrigin(collectById<ActivityId, ActivityRow>(change.activities), mergeActivity),
    ),
    blocks: noteWritten(
      before.blocks,
      after.blocks,
      origins.blocks,
      findOrigin(collectById<BlockId, BlockRow>(change.blocks), mergeBlock),
    ),
    settings: findSettingsOrigin(),
    devices: noteWritten(
      before.devices,
      after.devices,
      origins.devices,
      findOrigin(collectById<DeviceKey, DeviceRow>(change.devices), mergeDevice),
    ),
  };
}

/**
 * Whether a row is owed to the receiver: it changed after the point the receiver has, and its last
 * change didn't come from the receiver.
 */
const isOwed = (
  origin: Origin | undefined,
  since: ChangeNumber,
  receiver: DeviceKey,
): origin is Origin =>
  origin !== undefined && origin.changedAt > since && origin.changedBy !== receiver;

/**
 * What another device hasn't got of this device's rows: every row that changed here after `since`,
 * as it is now, except those whose last change came from the receiver. There's no queue of unsent
 * changes; this is it. Each block brings its activity's row along, as in every change, so it never
 * points at a row the receiver might not have.
 *
 * @param rows - This device's rows.
 * @param origins - Their origins.
 * @param since - How far the receiver has this device's changes: 0 for everything.
 * @param receiver - The device it's for.
 * @returns The rows as a change, sorted by id.
 */
export function collectSince(
  rows: Rows,
  origins: Origins,
  since: ChangeNumber,
  receiver: DeviceKey,
): Change {
  const collect = <Key extends string, Row>(
    held: ReadonlyMap<Key, Row>,
    heldOrigins: ReadonlyMap<Key, Origin>,
  ): Map<Key, Row> =>
    new Map(held.entries().filter(([key]) => isOwed(heldOrigins.get(key), since, receiver)));

  const activities = collect(rows.activities, origins.activities);
  const blocks = collect(rows.blocks, origins.blocks);
  for (const block of blocks.values()) {
    const id = block.existence.value.activityId;
    const activity = rows.activities.get(id);
    if (activity === undefined) throw new Error(`A block's activity ${id} has no row.`);

    activities.set(id, activity);
  }

  const settings: SettingsRow | null = isOwed(origins.settings, since, receiver)
    ? rows.settings
    : null;
  return {
    version: FORMAT_VERSION,
    activities: sortById(activities),
    blocks: sortById(blocks),
    settings,
    devices: sortById(collect(rows.devices, origins.devices)),
  };
}
