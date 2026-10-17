import { pickDefaultLook } from "./defaults";
import {
  createActivityId,
  createBlockId,
  sanitizeActivityId,
  sanitizeBlockId,
  type ActivityId,
  type BlockId,
} from "./id";
import {
  sanitizeBudgetMinutes,
  sanitizeDayCount,
  sanitizeDayEnd,
  sanitizeDayIndex,
  sanitizeDayMinute,
  sanitizeDayStart,
  sanitizeLength,
} from "./time";
import {
  PALETTE,
  SHAPES,
  createEmptyPlan,
  type Activity,
  type Block,
  type Hue,
  type Plan,
  type Shape,
} from "./types";

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
 * Turns anything loaded (storage, an import, another tab) into a valid plan: clamps numbers, snaps
 * times to the slot, gives activities with a missing or unknown color or shape their default (in
 * list order), gives invalid or repeated ids new ones, and drops blocks whose activity doesn't
 * exist.
 */
export function sanitizePlan(input: unknown): Plan {
  const plan = createEmptyPlan();
  if (!isRecord(input)) return plan;

  // Blocks find their activity by the id they were stored with, even when it got a new one here.
  const activityIds = new Map<string, ActivityId>();
  for (const raw of Array.isArray(input["activities"]) ? input["activities"] : []) {
    if (!isRecord(raw)) continue;
    const storedId = readString(raw["id"]);
    const kept = sanitizeActivityId(storedId);
    const isFirst = kept !== undefined && !activityIds.has(storedId);
    const id = isFirst ? kept : createActivityId();
    if (isFirst) activityIds.set(storedId, id);
    const mode = raw["mode"] === "day" ? "day" : "week";
    const look = pickDefaultLook(id, plan.activities);
    const hue = readNumber(raw["hue"]);
    const shape = readString(raw["shape"]);
    const activity: Activity = {
      id,
      name: readString(raw["name"]).trim().slice(0, 60) || "Untitled",
      hue: isHue(hue) ? hue : look.hue,
      shape: isShape(shape) ? shape : look.shape,
      mode,
      budgetMinutes: sanitizeBudgetMinutes(readNumber(raw["budgetMinutes"]), mode),
      days: sanitizeDayCount(readNumber(raw["days"])),
    };
    plan.activities.push(activity);
  }

  const blockIds = new Set<BlockId>();
  for (const raw of Array.isArray(input["blocks"]) ? input["blocks"] : []) {
    if (!isRecord(raw)) continue;
    const activityId = activityIds.get(readString(raw["activityId"]));
    if (!activityId) continue;
    const kept = sanitizeBlockId(readString(raw["id"]));
    const id = kept && !blockIds.has(kept) ? kept : createBlockId();
    blockIds.add(id);
    const block: Block = {
      id,
      activityId,
      day: sanitizeDayIndex(readNumber(raw["day"])),
      start: sanitizeDayMinute(readNumber(raw["start"])),
      length: sanitizeLength(readNumber(raw["length"])),
    };
    plan.blocks.push(block);
  }

  plan.dayStart = sanitizeDayStart(readNumber(input["dayStart"]));
  plan.dayEnd = sanitizeDayEnd(readNumber(input["dayEnd"]));
  plan.exampleLoadedAt = readTime(input["exampleLoadedAt"]);
  return plan;
}
