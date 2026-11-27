// The rows a plan is kept in, each split into exactly the registers of the table in Registers in
// docs/spec/merge.md, and merging two versions of one row.
import {
  parseDeviceKey,
  parseDeviceName,
  parseMembership,
  parseRelay,
  type DeviceKey,
  type DeviceName,
  type Membership,
  type Relay,
} from "../device/index.ts";
import type { Mode } from "../plan/activity/index.ts";
import { isHue, isShape, type Hue, type Shape } from "../plan/activity/look.ts";
import { sanitizeActivityName, type ActivityName } from "../plan/activity/name.ts";
import { sanitizeActivityId, sanitizeBlockId, type ActivityId, type BlockId } from "../plan/id.ts";
import {
  parseBudgetMinutes,
  parseDayCount,
  parseDayEnd,
  parseDayStart,
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeLength,
  type BudgetMinutes,
  type DayCount,
  type DayIndex,
  type DayMinute,
  type Hour,
  type Length,
} from "../plan/time.ts";
import type { Result } from "../result.ts";
import { parse as parseOrderKey, type OrderKey } from "./order.ts";
import { readExact } from "./record.ts";
import { merge as mergeRegisters, parse as parseRegister, type Register } from "./register.ts";

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

/** How a device is reached: set when it's added, and never changed. Its key is the row's id. */
type DeviceIdentity = { readonly relay: Relay };

/** A device in the group's device list (see The device list in docs/spec/self-service.md). */
export type DeviceRow = {
  readonly id: DeviceKey;
  readonly identity: Register<DeviceIdentity>;
  readonly name: Register<DeviceName>;
  readonly membership: Register<Membership>;
};

/**
 * The merged row, or the one held when no register changed, so a row nothing changed stays the
 * same object.
 *
 * @param first - The row the node holds.
 * @param merged - The row merged register by register.
 */
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

/** Two versions of one device's row, merged register by register. */
export const mergeDevice = (first: DeviceRow, second: DeviceRow): DeviceRow =>
  keepUnchanged(first, {
    id: first.id,
    identity: mergeRegisters(first.identity, second.identity),
    name: mergeRegisters(first.name, second.name),
    membership: mergeRegisters(first.membership, second.membership),
  });

// Parsing received rows strictly (see "What is received is checked" in docs/spec/merge.md). A
// value's parser gives back undefined for what it refuses; the row's parser names the problem.

/** Why a received row was refused. */
export type Problem =
  /** Not an object of the expected shape: a field missing, unknown or of the wrong kind. */
  | "not-a-change"
  | "invalid-stamp"
  | "invalid-id"
  /** A value out of range or not one the app could have written. */
  | "invalid-value"
  | "invalid-order-key";

/** The number, when the sanitizer leaves it as it is: a whole number in range, on a slot. */
const parseKept =
  <Of extends number>(sanitize: (value: number) => Of) =>
  (value: unknown): Of | undefined =>
    typeof value === "number" && sanitize(value) === value ? sanitize(value) : undefined;

const parseHue = (value: unknown): Hue | undefined => (isHue(value) ? value : undefined);
const parseShape = (value: unknown): Shape | undefined => (isShape(value) ? value : undefined);

/**
 * A name the sanitizer keeps as it is: trimmed, 1 to 60 characters. (`parseActivityName` would
 * give back its problem, "empty", as text, which can't be told apart from a name; see
 * SantaClaas/week-budget-planner#103.)
 */
function parseName(value: unknown): ActivityName | undefined {
  if (typeof value !== "string") return undefined;

  const name = sanitizeActivityName(value);
  return name === value ? name : undefined;
}

const parseMode = (value: unknown): Mode | undefined =>
  value === "week" || value === "day" ? value : undefined;

function parseBudget(value: unknown): Budget | undefined {
  const fields = readExact(value, ["mode", "budgetMinutes", "days"]);
  const mode = parseMode(fields?.["mode"]);
  const minutes = fields?.["budgetMinutes"];
  const days = fields?.["days"];
  if (mode === undefined || typeof minutes !== "number" || typeof days !== "number")
    return undefined;

  const budgetMinutes = parseBudgetMinutes(minutes, mode);
  const dayCount = parseDayCount(days);
  if (typeof budgetMinutes === "string" || typeof dayCount === "string") return undefined;

  // The parser rounds to the slot; a value it changed isn't one the app could have written.
  if (budgetMinutes !== minutes) return undefined;

  return { mode, budgetMinutes, days: dayCount };
}

function parseActivityExistence(value: unknown): ActivityExistence | undefined {
  const isDeleted = readExact(value, ["isDeleted"])?.["isDeleted"];
  return typeof isDeleted === "boolean" ? { isDeleted } : undefined;
}

const parseActivityId = (value: unknown): ActivityId | undefined =>
  typeof value === "string" ? sanitizeActivityId(value) : undefined;
const parseBlockId = (value: unknown): BlockId | undefined =>
  typeof value === "string" ? sanitizeBlockId(value) : undefined;

const ACTIVITY_FIELDS = ["id", "name", "hue", "shape", "budget", "order", "existence"] as const;

/** A received activity's row, parsed strictly. */
export function parseActivity(value: unknown): Result<ActivityRow, Problem> {
  const fields = readExact(value, ACTIVITY_FIELDS);
  if (fields === undefined) return "not-a-change";

  const id = parseActivityId(fields["id"]);
  if (id === undefined) return "invalid-id";

  const name = parseRegister(fields["name"], parseName, "invalid-value");
  if (typeof name === "string") return name;

  const hue = parseRegister(fields["hue"], parseHue, "invalid-value");
  if (typeof hue === "string") return hue;

  const shape = parseRegister(fields["shape"], parseShape, "invalid-value");
  if (typeof shape === "string") return shape;

  const budget = parseRegister(fields["budget"], parseBudget, "invalid-value");
  if (typeof budget === "string") return budget;

  const order = parseRegister(fields["order"], parseOrderKey, "invalid-order-key");
  if (typeof order === "string") return order;

  const existence = parseRegister(fields["existence"], parseActivityExistence, "invalid-value");
  if (typeof existence === "string") return existence;

  return { id, name, hue, shape, budget, order, existence };
}

const parseDay = parseKept<DayIndex>((value) => sanitizeDayIndex(value, Number.NaN));
const parseStart = parseKept<DayMinute>((value) => sanitizeDayMinute(value, Number.NaN));
const parseLength = parseKept<Length>((value) => sanitizeLength(value, Number.NaN));

function parseBlockTime(value: unknown): BlockTime | undefined {
  const fields = readExact(value, ["day", "start", "length"]);
  const day = parseDay(fields?.["day"]);
  const start = parseStart(fields?.["start"]);
  const length = parseLength(fields?.["length"]);
  if (day === undefined || start === undefined || length === undefined) return undefined;

  return { day, start, length };
}

function parseBlockExistence(value: unknown): BlockExistence | undefined {
  const fields = readExact(value, ["activityId", "isDeleted"]);
  const activityId = parseActivityId(fields?.["activityId"]);
  const isDeleted = fields?.["isDeleted"];
  if (activityId === undefined || typeof isDeleted !== "boolean") return undefined;

  return { activityId, isDeleted };
}

/** A received block's row, parsed strictly. */
export function parseBlock(value: unknown): Result<BlockRow, Problem> {
  const fields = readExact(value, ["id", "time", "existence"]);
  if (fields === undefined) return "not-a-change";

  const id = parseBlockId(fields["id"]);
  if (id === undefined) return "invalid-id";

  const time = parseRegister(fields["time"], parseBlockTime, "invalid-value");
  if (typeof time === "string") return time;

  const existence = parseRegister(fields["existence"], parseBlockExistence, "invalid-value");
  if (typeof existence === "string") return existence;

  return { id, time, existence };
}

const parseHour =
  (parse: (value: number) => Result<Hour, "out-of-range">) =>
  (value: unknown): Hour | undefined => {
    const hour = typeof value === "number" ? parse(value) : "out-of-range";
    return hour === "out-of-range" ? undefined : hour;
  };

/** Null, or a time as `sanitizePlan` keeps it: an ISO 8601 instant in UTC, normalized. */
function parseExampleLoadedAt(value: unknown): string | null | undefined {
  if (value === null) return null;

  if (typeof value !== "string") return undefined;

  let normalized: string;
  try {
    normalized = Temporal.Instant.from(value).toString();
  } catch {
    return undefined;
  }

  return normalized === value ? value : undefined;
}

/** A received settings row, parsed strictly. */
export function parseSettings(value: unknown): Result<SettingsRow, Problem> {
  const fields = readExact(value, ["dayStart", "dayEnd", "exampleLoadedAt"]);
  if (fields === undefined) return "not-a-change";

  const dayStart = parseRegister(fields["dayStart"], parseHour(parseDayStart), "invalid-value");
  if (typeof dayStart === "string") return dayStart;

  const dayEnd = parseRegister(fields["dayEnd"], parseHour(parseDayEnd), "invalid-value");
  if (typeof dayEnd === "string") return dayEnd;

  const exampleLoadedAt = parseRegister(
    fields["exampleLoadedAt"],
    parseExampleLoadedAt,
    "invalid-value",
  );
  if (typeof exampleLoadedAt === "string") return exampleLoadedAt;

  return { dayStart, dayEnd, exampleLoadedAt };
}

function parseDeviceIdentity(value: unknown): DeviceIdentity | undefined {
  const relay = parseRelay(readExact(value, ["relay"])?.["relay"]);
  return relay === undefined ? undefined : { relay };
}

function parseMembershipValue(value: unknown): Membership | undefined {
  const fields = readExact(value, ["status", "proof"]);
  return fields && parseMembership(fields["status"], fields["proof"]);
}

/** A received device's row, parsed strictly. */
export function parseDevice(value: unknown): Result<DeviceRow, Problem> {
  const fields = readExact(value, ["id", "identity", "name", "membership"]);
  if (fields === undefined) return "not-a-change";

  const id = parseDeviceKey(fields["id"]);
  if (id === undefined) return "invalid-id";

  const identity = parseRegister(fields["identity"], parseDeviceIdentity, "invalid-value");
  if (typeof identity === "string") return identity;

  const name = parseRegister(fields["name"], parseDeviceName, "invalid-value");
  if (typeof name === "string") return name;

  const membership = parseRegister(fields["membership"], parseMembershipValue, "invalid-value");
  if (typeof membership === "string") return membership;

  return { id, identity, name, membership };
}
