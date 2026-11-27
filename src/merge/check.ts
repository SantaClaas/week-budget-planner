// The strict check on a change or a snapshot that was received (see "What is received is checked"
// in docs/spec/merge.md). Anything invalid is refused whole, never repaired: repairing would put a
// value nobody wrote under a stamp that says a node wrote it. Each row is parsed by its own module
// (row.ts); this puts the rows together and checks what only the whole change can tell.
import type { Result } from "../result.ts";
import { FORMAT_VERSION, type Change } from "./index.ts";
import { isRecord, readExact } from "./record.ts";
import {
  parseActivity,
  parseBlock,
  parseDevice,
  parseSettings,
  type Problem as RowProblem,
} from "./row.ts";

/**
 * Why a change was refused. "newer-version" when a newer version of the app made it, so the node
 * stops merging until the app is updated; the others name what was invalid.
 */
export type Problem =
  | RowProblem
  | "newer-version"
  /** Two rows of one kind with the same id. */
  | "repeated-id"
  /** A block whose activity's row isn't in the change. */
  | "missing-activity";

/** Every item parsed, or the first problem. Two rows with the same id are refused. */
function parseList<Row extends { id: string }>(
  value: unknown,
  parseRow: (value: unknown) => Result<Row, RowProblem>,
): Result<Row[], Problem> {
  if (!Array.isArray(value)) return "not-a-change";

  const rows: Row[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const row = parseRow(item);
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

  const fields = readExact(value, ["version", "activities", "blocks", "settings", "devices"]);
  if (fields?.["version"] !== FORMAT_VERSION) return "not-a-change";

  const activities = parseList(fields["activities"], parseActivity);
  if (typeof activities === "string") return activities;

  const blocks = parseList(fields["blocks"], parseBlock);
  if (typeof blocks === "string") return blocks;

  const settings = fields["settings"] === null ? null : parseSettings(fields["settings"]);
  if (typeof settings === "string") return settings;

  const devices = parseList(fields["devices"], parseDevice);
  if (typeof devices === "string") return devices;

  const activityIds = new Set(activities.values().map((row) => row.id));
  const blockActivityIds = new Set(blocks.values().map((row) => row.existence.value.activityId));
  if (!blockActivityIds.isSubsetOf(activityIds)) return "missing-activity";

  return { version: FORMAT_VERSION, activities, blocks, settings, devices };
}
