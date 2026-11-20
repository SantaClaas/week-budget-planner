// The strict check on a change or a snapshot that was received (see "What is received is checked"
// in docs/spec/merge.md). Anything invalid is refused whole, never repaired: repairing would put a
// value nobody wrote under a stamp that says a node wrote it.
import type { Mode } from "../plan/activity/index.ts";
import { PALETTE, SHAPES, type Hue, type Shape } from "../plan/activity/look.ts";
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
  type DayIndex,
  type DayMinute,
  type Hour,
  type Length,
} from "../plan/time.ts";
import type { Result } from "../result.ts";
import { FORMAT_VERSION, type Change } from "./index.ts";
import { parse as parseOrderKey, type OrderKey } from "./order.ts";
import type { Register, Value } from "./register.ts";
import type {
  ActivityExistence,
  ActivityRow,
  BlockExistence,
  BlockRow,
  BlockTime,
  Budget,
  SettingsRow,
} from "./row.ts";
import { parse as parseStamp } from "./stamp.ts";

/**
 * Why a change was refused. "newer-version" when a newer version of the app made it, so the node
 * stops merging until the app is updated; the others name what was invalid.
 */
export type Problem =
  /** Not an object of the expected shape: a field missing, unknown or of the wrong kind. */
  | "not-a-change"
  | "newer-version"
  | "invalid-stamp"
  | "invalid-id"
  /** Two rows of one kind with the same id. */
  | "repeated-id"
  /** A value out of range or not one the app could have written. */
  | "invalid-value"
  | "invalid-order-key"
  /** A block whose activity's row isn't in the change. */
  | "missing-activity";

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The object, when it has exactly these fields: none missing and none unknown. */
function readFields(value: unknown, names: readonly string[]): Fields | undefined {
  if (!isRecord(value)) return undefined;

  const keys = Object.keys(value);
  const isExact = keys.length === names.length && names.every((name) => Object.hasOwn(value, name));
  return isExact ? value : undefined;
}

/** A value's reader: the checked value, or undefined when it isn't valid. */
type Reader<Of> = (value: unknown) => Of | undefined;

/** A register, read strictly: a value its reader accepts, and a well-formed stamp. */
function readRegister<Of extends Value>(
  value: unknown,
  readValue: Reader<Of>,
  problem: Problem,
): Result<Register<Of>, Problem> {
  const fields = readFields(value, ["value", "stamp"]);
  if (fields === undefined) return "not-a-change";

  const stamp = parseStamp(fields["stamp"]);
  if (stamp === undefined) return "invalid-stamp";

  const checked = readValue(fields["value"]);
  return checked === undefined ? problem : { value: checked, stamp };
}

/** The number, when the sanitizer leaves it as it is: a whole number in range, on a slot. */
const readKept =
  <Of extends number>(sanitize: (value: number) => Of): Reader<Of> =>
  (value) =>
    typeof value === "number" && sanitize(value) === value ? sanitize(value) : undefined;

const PALETTE_HUES = new Set<unknown>(PALETTE.values().map((color) => color.hue));
const SHAPE_NAMES = new Set<unknown>(SHAPES);

const isHue = (value: unknown): value is Hue => PALETTE_HUES.has(value);
const isShape = (value: unknown): value is Shape => SHAPE_NAMES.has(value);
const readHue: Reader<Hue> = (value) => (isHue(value) ? value : undefined);
const readShape: Reader<Shape> = (value) => (isShape(value) ? value : undefined);

/**
 * A name the sanitizer keeps as it is: trimmed, 1 to 60 characters. (`parseActivityName` would
 * give back its problem, "empty", as text, which can't be told apart from a name.)
 */
function readName(value: unknown): ActivityName | undefined {
  if (typeof value !== "string") return undefined;

  const name = sanitizeActivityName(value);
  return name === value ? name : undefined;
}

const readMode = (value: unknown): Mode | undefined =>
  value === "week" || value === "day" ? value : undefined;

function readBudget(value: unknown): Budget | undefined {
  const fields = readFields(value, ["mode", "budgetMinutes", "days"]);
  const mode = readMode(fields?.["mode"]);
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

function readActivityExistence(value: unknown): ActivityExistence | undefined {
  const isDeleted = readFields(value, ["isDeleted"])?.["isDeleted"];
  return typeof isDeleted === "boolean" ? { isDeleted } : undefined;
}

const readOrderKey: Reader<OrderKey> = parseOrderKey;

const readActivityId: Reader<ActivityId> = (value) =>
  typeof value === "string" ? sanitizeActivityId(value) : undefined;
const readBlockId: Reader<BlockId> = (value) =>
  typeof value === "string" ? sanitizeBlockId(value) : undefined;

const ACTIVITY_FIELDS = ["id", "name", "hue", "shape", "budget", "order", "existence"] as const;

function readActivity(value: unknown): Result<ActivityRow, Problem> {
  const fields = readFields(value, ACTIVITY_FIELDS);
  if (fields === undefined) return "not-a-change";

  const id = readActivityId(fields["id"]);
  if (id === undefined) return "invalid-id";

  const name = readRegister(fields["name"], readName, "invalid-value");
  if (typeof name === "string") return name;

  const hue = readRegister(fields["hue"], readHue, "invalid-value");
  if (typeof hue === "string") return hue;

  const shape = readRegister(fields["shape"], readShape, "invalid-value");
  if (typeof shape === "string") return shape;

  const budget = readRegister(fields["budget"], readBudget, "invalid-value");
  if (typeof budget === "string") return budget;

  const order = readRegister(fields["order"], readOrderKey, "invalid-order-key");
  if (typeof order === "string") return order;

  const existence = readRegister(fields["existence"], readActivityExistence, "invalid-value");
  if (typeof existence === "string") return existence;

  return { id, name, hue, shape, budget, order, existence };
}

const readDay = readKept<DayIndex>((value) => sanitizeDayIndex(value, Number.NaN));
const readStart = readKept<DayMinute>((value) => sanitizeDayMinute(value, Number.NaN));
const readLength = readKept<Length>((value) => sanitizeLength(value, Number.NaN));

function readTime(value: unknown): BlockTime | undefined {
  const fields = readFields(value, ["day", "start", "length"]);
  const day = readDay(fields?.["day"]);
  const start = readStart(fields?.["start"]);
  const length = readLength(fields?.["length"]);
  if (day === undefined || start === undefined || length === undefined) return undefined;

  return { day, start, length };
}

function readBlockExistence(value: unknown): BlockExistence | undefined {
  const fields = readFields(value, ["activityId", "isDeleted"]);
  const activityId = readActivityId(fields?.["activityId"]);
  const isDeleted = fields?.["isDeleted"];
  if (activityId === undefined || typeof isDeleted !== "boolean") return undefined;

  return { activityId, isDeleted };
}

function readBlock(value: unknown): Result<BlockRow, Problem> {
  const fields = readFields(value, ["id", "time", "existence"]);
  if (fields === undefined) return "not-a-change";

  const id = readBlockId(fields["id"]);
  if (id === undefined) return "invalid-id";

  const time = readRegister(fields["time"], readTime, "invalid-value");
  if (typeof time === "string") return time;

  const existence = readRegister(fields["existence"], readBlockExistence, "invalid-value");
  if (typeof existence === "string") return existence;

  return { id, time, existence };
}

const readHour =
  (parseHour: (value: number) => Result<Hour, "out-of-range">): Reader<Hour> =>
  (value) => {
    const hour = typeof value === "number" ? parseHour(value) : "out-of-range";
    return hour === "out-of-range" ? undefined : hour;
  };

/** Null, or a time as `sanitizePlan` keeps it: an ISO 8601 instant in UTC, normalized. */
function readExampleLoadedAt(value: unknown): string | null | undefined {
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

function readSettings(value: unknown): Result<SettingsRow, Problem> {
  const fields = readFields(value, ["dayStart", "dayEnd", "exampleLoadedAt"]);
  if (fields === undefined) return "not-a-change";

  const dayStart = readRegister(fields["dayStart"], readHour(parseDayStart), "invalid-value");
  if (typeof dayStart === "string") return dayStart;

  const dayEnd = readRegister(fields["dayEnd"], readHour(parseDayEnd), "invalid-value");
  if (typeof dayEnd === "string") return dayEnd;

  const exampleLoadedAt = readRegister(
    fields["exampleLoadedAt"],
    readExampleLoadedAt,
    "invalid-value",
  );
  if (typeof exampleLoadedAt === "string") return exampleLoadedAt;

  return { dayStart, dayEnd, exampleLoadedAt };
}

/** Every item read, or the first problem. Two rows with the same id are refused. */
function readList<Row extends { id: string }>(
  value: unknown,
  readRow: (value: unknown) => Result<Row, Problem>,
): Result<Row[], Problem> {
  if (!Array.isArray(value)) return "not-a-change";

  const rows: Row[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const row = readRow(item);
    if (typeof row === "string") return row;

    if (ids.has(row.id)) return "repeated-id";

    ids.add(row.id);
    rows.push(row);
  }

  return rows;
}

/** Whether a newer version of the app made it: a `version` above this one's. */
const isFromNewerVersion = (value: unknown): boolean =>
  isRecord(value) && typeof value["version"] === "number" && value["version"] > FORMAT_VERSION;

/**
 * A received change or snapshot, parsed strictly: every value valid by the same rules as the
 * app's strict parsers, every stamp well formed, every block's activity in it. Anything else is
 * refused whole, with what was wrong.
 */
export function parse(value: unknown): Result<Change, Problem> {
  if (isFromNewerVersion(value)) return "newer-version";

  const fields = readFields(value, ["version", "activities", "blocks", "settings"]);
  if (fields?.["version"] !== FORMAT_VERSION) return "not-a-change";

  const activities = readList(fields["activities"], readActivity);
  if (typeof activities === "string") return activities;

  const blocks = readList(fields["blocks"], readBlock);
  if (typeof blocks === "string") return blocks;

  const settings = fields["settings"] === null ? null : readSettings(fields["settings"]);
  if (typeof settings === "string") return settings;

  const activityIds = new Set(activities.values().map((row) => row.id));
  const isEveryActivityThere = blocks.every((row) =>
    activityIds.has(row.existence.value.activityId),
  );
  if (!isEveryActivityThere) return "missing-activity";

  return { version: FORMAT_VERSION, activities, blocks, settings };
}
