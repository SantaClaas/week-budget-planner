import { placedByActivity, target } from "./budget";
import { clamp } from "./time";
import {
  DAY,
  DEFAULT_SHAPES,
  MAX_LENGTH,
  PALETTE,
  SLOT,
  WEEKLY_DEFAULT_LENGTH,
  type Activity,
  type Block,
  type Plan,
} from "./types";

/** 32-bit FNV-1a over the UTF-8 bytes of `text`. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The first item from `start` (wrapping) that isn't in `used`, or the one at `start` if all are. */
function firstUnused<T>(items: readonly T[], start: number, used: ReadonlySet<T>): T {
  for (let step = 0; step < items.length; step++) {
    const item = items[(start + step) % items.length]!;
    if (!used.has(item)) return item;
  }
  return items[start]!;
}

/**
 * The default color and shape for an activity, ideally ones no other activity uses yet. Derived
 * from the id, so the same id and the same other activities always give the same result.
 */
export function defaultLook(
  id: string,
  others: readonly Pick<Activity, "hue" | "shape">[],
): { hue: number; shape: string } {
  const hash = fnv1a32(id);
  const hues = PALETTE.map((color) => color.hue);
  const hue = firstUnused(hues, hash % hues.length, new Set(others.map((other) => other.hue)));
  const shape = firstUnused<string>(
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
export function defaultLength(activity: Activity, blocks: readonly Block[]): number {
  const left = target(activity) - (placedByActivity(blocks).get(activity.id) ?? 0);
  let length = activity.mode === "day" ? activity.budgetMinutes : WEEKLY_DEFAULT_LENGTH;
  if (left > 0) length = Math.min(length, left);
  return clamp(length, SLOT, MAX_LENGTH);
}

/**
 * Caps a new block's length so that a block starting inside the day hours ends by their end.
 * Blocks starting outside the day hours keep their length.
 */
export function fitToDayHours(
  start: number,
  length: number,
  plan: Pick<Plan, "dayStart" | "dayEnd">,
): number {
  const dayStart = plan.dayStart * 60;
  const dayEnd = plan.dayEnd * 60;
  if (start < dayStart || start >= dayEnd) return length;
  return clamp(Math.min(length, dayEnd - start), SLOT, DAY);
}
