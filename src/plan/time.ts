import { SLOT } from "./types";

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Rounds to the nearest slot. */
export const snap = (minutes: number): number => Math.round(minutes / SLOT) * SLOT;

/** Rounds down to the slot that contains the minute, for pointer positions. */
export const snapDown = (minutes: number): number => Math.floor(minutes / SLOT) * SLOT;
