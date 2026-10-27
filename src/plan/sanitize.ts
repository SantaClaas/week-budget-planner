import { sanitizeActivityName } from "./activity-name.ts";
import { pickDefaultLook } from "./defaults.ts";
import {
  createActivityId,
  createBlockId,
  sanitizeActivityId,
  sanitizeBlockId,
  type ActivityId,
  type BlockId,
} from "./id.ts";
import {
  sanitizeBudgetMinutes,
  sanitizeDayCount,
  sanitizeDayEnd,
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength,
} from "./time.ts";
import {
  PALETTE,
  SHAPES,
  createEmptyPlan,
  type Activity,
  type Block,
  type Hue,
  type Plan,
  type Shape,
} from "./types.ts";

const PALETTE_HUES = new Set<number>(PALETTE.map((color) => color.hue));
const SHAPE_NAMES = new Set<string>(SHAPES);

const isHue = (value: number): value is Hue => PALETTE_HUES.has(value);
const isShape = (value: string): value is Shape => SHAPE_NAMES.has(value);

/** A valid instant as a normalized ISO 8601 time in UTC, or null. */
function readTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return Temporal.Instant.from(value).toString();
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Anything loaded becomes a number for the sanitizers; what isn't one becomes NaN, their fallback. */
const readNumber = (value: unknown): number =>
  typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
const readString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The activities, and the id each one was stored with mapped to the id it has now, which the
 * blocks find their activity by. An activity with an invalid or repeated id gets a new one.
 */
function sanitizeActivities(input: unknown): {
  activities: Activity[];
  idsByStoredId: Map<string, ActivityId>;
} {
  const activities: Activity[] = [];
  const idsByStoredId = new Map<string, ActivityId>();
  if (!Array.isArray(input)) return { activities, idsByStoredId };

  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const storedId = readString(raw["id"]);
    const kept = sanitizeActivityId(storedId);
    const isFirst = kept !== undefined && !idsByStoredId.has(storedId);
    const id = isFirst ? kept : createActivityId();
    if (isFirst) idsByStoredId.set(storedId, id);
    const mode = raw["mode"] === "day" ? "day" : "week";
    const look = pickDefaultLook(id, activities);
    const hue = readNumber(raw["hue"]);
    const shape = readString(raw["shape"]);
    activities.push({
      id,
      name: sanitizeActivityName(readString(raw["name"])),
      hue: isHue(hue) ? hue : look.hue,
      shape: isShape(shape) ? shape : look.shape,
      mode,
      budgetMinutes: sanitizeBudgetMinutes(readNumber(raw["budgetMinutes"]), mode),
      days: sanitizeDayCount(readNumber(raw["days"])),
    });
  }
  return { activities, idsByStoredId };
}

/** The blocks whose activity exists. A block with an invalid or repeated id gets a new one. */
function sanitizeBlocks(
  input: unknown,
  activityIdsByStoredId: ReadonlyMap<string, ActivityId>,
): Block[] {
  if (!Array.isArray(input)) return [];

  const blocks: Block[] = [];
  const ids = new Set<BlockId>();
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const activityId = activityIdsByStoredId.get(readString(raw["activityId"]));
    if (!activityId) continue;
    const kept = sanitizeBlockId(readString(raw["id"]));
    const id = kept && !ids.has(kept) ? kept : createBlockId();
    ids.add(id);
    blocks.push({
      id,
      activityId,
      day: sanitizeDayIndex(readNumber(raw["day"])),
      start: sanitizeDayMinute(readNumber(raw["start"])),
      length: sanitizeLength(readNumber(raw["length"])),
    });
  }
  return blocks;
}

/**
 * Turns anything loaded (storage, an import, another tab) into a valid plan: clamps numbers, snaps
 * times to the slot, gives activities with a missing or unknown color or shape their default (in
 * list order), gives invalid or repeated ids new ones, and drops blocks whose activity doesn't
 * exist.
 */
export function sanitizePlan(input: unknown): Plan {
  if (!isRecord(input)) return createEmptyPlan();

  const { activities, idsByStoredId } = sanitizeActivities(input["activities"]);
  return {
    version: 1,
    activities,
    blocks: sanitizeBlocks(input["blocks"], idsByStoredId),
    dayStart: sanitizeDayStart(readNumber(input["dayStart"])),
    dayEnd: sanitizeDayEnd(readNumber(input["dayEnd"])),
    exampleLoadedAt: readTime(input["exampleLoadedAt"]),
  };
}
