import { SLOT } from "./types";

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Rounds to the nearest slot. */
export const snap = (minutes: number): number => Math.round(minutes / SLOT) * SLOT;

/** Rounds down to the slot that contains the minute, for pointer positions. */
export const snapDown = (minutes: number): number => Math.floor(minutes / SLOT) * SLOT;

/** "1 h 30 min", "45 min", "3 h". */
export function formatLength(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Compact form for blocks and day totals: "1h30", "45m", "3h". */
export function formatShort(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

/** "07:30". Minutes past midnight wrap, so 1500 is "01:00". */
export function formatClock(minutes: number): string {
  const inDay = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(inDay / 60);
  return `${String(hours).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
}
