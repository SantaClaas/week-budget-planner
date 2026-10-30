// An activity's look: its color and its shape, and the default a new activity gets.

/** The eight activity colors, keyed by the stored hue value. */
export const PALETTE = [
  { hue: 255, name: "Blue", key: "blue" },
  { hue: 28, name: "Red", key: "red" },
  { hue: 152, name: "Green", key: "green" },
  { hue: 78, name: "Amber", key: "amber" },
  { hue: 305, name: "Violet", key: "violet" },
  { hue: 198, name: "Teal", key: "teal" },
  { hue: 350, name: "Pink", key: "pink" },
  { hue: 118, name: "Lime", key: "lime" },
] as const;

/** All 35 shapes of Google's Material 3 Expressive shape library (see docs/design/m3-shapes.css). */
export const SHAPES = [
  "circle",
  "square",
  "slanted",
  "arch",
  "fan",
  "arrow",
  "semi-circle",
  "oval",
  "pill",
  "triangle",
  "diamond",
  "clam-shell",
  "pentagon",
  "gem",
  "sunny",
  "very-sunny",
  "cookie-4",
  "cookie-6",
  "cookie-7",
  "cookie-9",
  "cookie-12",
  "ghostish",
  "clover-4",
  "clover-8",
  "burst",
  "soft-burst",
  "boom",
  "soft-boom",
  "flower",
  "puffy",
  "puffy-diamond",
  "pixel-circle",
  "pixel-triangle",
  "bun",
  "heart",
] as const;

/**
 * The shapes new activities get by default: the library minus the ones that are hard to tell apart
 * when small, ordered so neighbours look different. The order is part of the spec; don't sort it.
 */
export const DEFAULT_SHAPES = [
  "circle",
  "heart",
  "triangle",
  "cookie-4",
  "arch",
  "clover-4",
  "diamond",
  "sunny",
  "pill",
  "gem",
  "fan",
  "cookie-6",
  "slanted",
  "flower",
  "pentagon",
  "burst",
  "semi-circle",
  "clover-8",
  "arrow",
  "puffy",
  "square",
  "cookie-9",
  "ghostish",
  "soft-burst",
  "oval",
  "very-sunny",
  "clam-shell",
  "puffy-diamond",
  "bun",
  "cookie-12",
] as const satisfies readonly (typeof SHAPES)[number][];

export type Hue = (typeof PALETTE)[number]["hue"];
export type Shape = (typeof SHAPES)[number];

/** The palette's hues, in its order. */
const HUES: readonly Hue[] = PALETTE.map((color) => color.hue);

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
  others: readonly { readonly hue: Hue; readonly shape: Shape }[],
): { hue: Hue; shape: Shape } {
  const hash = hashFnv1a32(id);
  const hue = findFirstUnused(
    HUES,
    hash % HUES.length,
    new Set(others.values().map((other) => other.hue)),
  );
  const shape = findFirstUnused<Shape>(
    DEFAULT_SHAPES,
    (hash >>> 8) % DEFAULT_SHAPES.length,
    new Set(others.values().map((other) => other.shape)),
  );
  return { hue, shape };
}
