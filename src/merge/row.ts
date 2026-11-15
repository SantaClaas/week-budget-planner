// The rows a plan is kept in, each split into exactly the registers of the table in Registers in
// docs/spec/merge.md, and merging two versions of one row.
import type { Mode } from "../plan/activity/index.ts";
import type { Hue, Shape } from "../plan/activity/look.ts";
import type { ActivityName } from "../plan/activity/name.ts";
import type { ActivityId, BlockId } from "../plan/id.ts";
import type { BudgetMinutes, DayCount, DayIndex, DayMinute, Hour, Length } from "../plan/time.ts";
import type { OrderKey } from "./order.ts";
import { merge as mergeRegisters, type Register } from "./register.ts";

/** An activity's budget: one register, since a per-day budget's limit depends on the mode. */
export type Budget = {
  readonly mode: Mode;
  readonly budgetMinutes: BudgetMinutes;
  readonly days: DayCount;
};

/** Whether an activity is deleted. A deleted row stays, as a deletion marker (see Deleting). */
export type ActivityExistence = { readonly isDeleted: boolean };

export type ActivityRow = {
  readonly id: ActivityId;
  readonly name: Register<ActivityName>;
  readonly hue: Register<Hue>;
  readonly shape: Register<Shape>;
  readonly budget: Register<Budget>;
  readonly order: Register<OrderKey>;
  readonly existence: Register<ActivityExistence>;
};

/** Where a block is: one register, since moving and resizing set these together. */
export type BlockTime = {
  readonly day: DayIndex;
  readonly start: DayMinute;
  readonly length: Length;
};

/**
 * Whether a block is deleted, and its activity, which is set when the block is added and never
 * changes, so a block's row always says which activity it belongs to.
 */
export type BlockExistence = { readonly activityId: ActivityId; readonly isDeleted: boolean };

export type BlockRow = {
  readonly id: BlockId;
  readonly time: Register<BlockTime>;
  readonly existence: Register<BlockExistence>;
};

/** The plan's one row of settings. The ends of the day hours never conflict, so each is its own. */
export type SettingsRow = {
  readonly dayStart: Register<Hour>;
  readonly dayEnd: Register<Hour>;
  /** When the example week was loaded, as an ISO 8601 time in UTC, or null (see `Plan`). */
  readonly exampleLoadedAt: Register<string | null>;
};

/** Gives back `first` when no register changed, so a row nothing changed stays the same object. */
function keepUnchanged<Row extends object>(first: Row, merged: Row): Row {
  const isUnchanged = Object.keys(first).every(
    (key) => Reflect.get(first, key) === Reflect.get(merged, key),
  );
  return isUnchanged ? first : merged;
}

/** Two versions of one activity's row, merged register by register. */
export const mergeActivity = (first: ActivityRow, second: ActivityRow): ActivityRow =>
  keepUnchanged(first, {
    id: first.id,
    name: mergeRegisters(first.name, second.name),
    hue: mergeRegisters(first.hue, second.hue),
    shape: mergeRegisters(first.shape, second.shape),
    budget: mergeRegisters(first.budget, second.budget),
    order: mergeRegisters(first.order, second.order),
    existence: mergeRegisters(first.existence, second.existence),
  });

/** Two versions of one block's row, merged register by register. */
export const mergeBlock = (first: BlockRow, second: BlockRow): BlockRow =>
  keepUnchanged(first, {
    id: first.id,
    time: mergeRegisters(first.time, second.time),
    existence: mergeRegisters(first.existence, second.existence),
  });

/** Two versions of the settings row, merged register by register. */
export const mergeSettings = (first: SettingsRow, second: SettingsRow): SettingsRow =>
  keepUnchanged(first, {
    dayStart: mergeRegisters(first.dayStart, second.dayStart),
    dayEnd: mergeRegisters(first.dayEnd, second.dayEnd),
    exampleLoadedAt: mergeRegisters(first.exampleLoadedAt, second.exampleLoadedAt),
  });
