import type { Format } from "../plan/format.ts";

/** Sizes under a megabyte read in kilobytes, the rest in megabytes. */
const MEGABYTE = 1_000_000;

/** A size in bytes as the Storage section shows it: "48 kB", "1.2 MB", in the user's language. */
export function formatSize(bytes: number, format: Format = {}): string {
  const isLarge = bytes >= MEGABYTE;
  return new Intl.NumberFormat(format.locale, {
    style: "unit",
    unit: isLarge ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: isLarge ? 1 : 0,
  }).format(isLarge ? bytes / MEGABYTE : Math.max(1, Math.round(bytes / 1000)));
}
