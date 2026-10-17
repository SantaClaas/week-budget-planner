import { sumPlacedByActivity, calculateWeeklyBudget } from "./budget.ts";
import { DAY, MAX_LENGTH, SLOT, clamp, sanitizeLength, type Length } from "./time.ts";
import {
  DEFAULT_SHAPES,
  PALETTE,
  type Activity,
  type Block,
  type Hue,
  type Plan,
  type Shape,
} from "./types.ts";

/** Default length for activities counted per week: one lecture slot. */
const WEEKLY_DEFAULT_LENGTH = 90;

/** 32-bit FNV-1a over the UTF-8 bytes of `text`. */
export function hashFnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The first item from `start` (wrapping) that isn't in `used`, or the one at `start` if all are. */
function findFirstUnused<T>(items: readonly T[], start: number, used: ReadonlySet<T>): T {
  for (let step = 0; step < items.length; step++) {
    const item = items[(start + step) % items.length];
    if (item !== undefined && !used.has(item)) return item;
  }
  const fallback = items[start];
  if (fallback === undefined)
    throw new RangeError(`No item at ${start.toString()} to fall back to.`);
  return fallback;
}

/**
 * The default color and shape for an activity, ideally ones no other activity uses yet. Derived
 * from the id, so the same id and the same other activities always give the same result.
 */
export function pickDefaultLook(
  id: string,
  others: readonly Pick<Activity, "hue" | "shape">[],
): { hue: Hue; shape: Shape } {
  const hash = hashFnv1a32(id);
  const hues: Hue[] = PALETTE.map((color) => color.hue);
  const hue = findFirstUnused(hues, hash % hues.length, new Set(others.map((other) => other.hue)));
  const shape = findFirstUnused<Shape>(
    DEFAULT_SHAPES,
    (hash >>> 8) % DEFAULT_SHAPES.length,
    new Set(others.map((other) => other.shape)),
  );
  return { hue, shape };
}

/**
 * The length a new block gets: the per-day budget for per-day activities, otherwise one lecture
 * slot, capped at what's left when something is, never under one slot or over a day.
 */
export function pickDefaultLength(activity: Activity, blocks: readonly Block[]): Length {
  const left =
    calculateWeeklyBudget(activity) - (sumPlacedByActivity(blocks).get(activity.id) ?? 0);
  let length: number = activity.mode === "day" ? activity.budgetMinutes : WEEKLY_DEFAULT_LENGTH;
  if (left > 0) length = Math.min(length, left);
  return sanitizeLength(clamp(length, SLOT, MAX_LENGTH));
}

/**
 * Caps a new block's length so that a block starting inside the day hours ends by their end.
 * Blocks starting outside the day hours keep their length.
 */
export function fitToDayHours(
  start: number,
  length: Length,
  plan: Pick<Plan, "dayStart" | "dayEnd">,
): Length {
  const dayStart = plan.dayStart * 60;
  const dayEnd = plan.dayEnd * 60;
  if (start < dayStart || start >= dayEnd) return length;
  return sanitizeLength(clamp(Math.min(length, dayEnd - start), SLOT, DAY));
}
