import { pickDefaultLook } from "./defaults";
import { clamp, snap } from "./time";
import {
  DAY,
  MAX_LENGTH,
  PALETTE,
  SHAPES,
  SLOT,
  WEEK,
  createEmptyPlan,
  type Activity,
  type Block,
  type Plan,
} from "./types";

export const createId = (): string => crypto.randomUUID();

const PALETTE_HUES = new Set<number>(PALETTE.map((color) => color.hue));
const SHAPE_NAMES = new Set<string>(SHAPES);

function readInteger(value: unknown, low: number, high: number, fallback: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? clamp(number, low, high) : fallback;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Turns anything loaded (storage, an import, another tab) into a valid plan: clamps numbers, snaps
 * times to the slot, gives activities with a missing or unknown color or shape their default (in
 * list order), drops blocks whose activity doesn't exist, and de-duplicates ids.
 */
export function sanitizePlan(input: unknown): Plan {
  const plan = createEmptyPlan();
  if (!isRecord(input)) return plan;

  const activityIds = new Set<string>();
  for (const raw of Array.isArray(input["activities"]) ? input["activities"] : []) {
    if (!isRecord(raw)) continue;
    let id = String(raw["id"] ?? "").slice(0, 40);
    if (!id || activityIds.has(id)) id = createId();
    activityIds.add(id);
    const mode = raw["mode"] === "day" ? "day" : "week";
    const look = pickDefaultLook(id, plan.activities);
    const hue = Number(raw["hue"]);
    const shape = String(raw["shape"] ?? "");
    const activity: Activity = {
      id,
      name: String(raw["name"] ?? "").trim().slice(0, 60) || "Untitled",
      hue: PALETTE_HUES.has(hue) ? hue : look.hue,
      shape: SHAPE_NAMES.has(shape) ? shape : look.shape,
      mode,
      budgetMinutes: Math.max(SLOT, snap(readInteger(raw["budgetMinutes"], SLOT, mode === "day" ? DAY : WEEK, 60))),
      days: readInteger(raw["days"], 1, 7, 5),
    };
    plan.activities.push(activity);
  }

  const blockIds = new Set<string>();
  for (const raw of Array.isArray(input["blocks"]) ? input["blocks"] : []) {
    if (!isRecord(raw)) continue;
    const activityId = String(raw["activityId"] ?? "");
    if (!activityIds.has(activityId)) continue;
    let id = String(raw["id"] ?? "").slice(0, 40);
    if (!id || blockIds.has(id)) id = createId();
    blockIds.add(id);
    const block: Block = {
      id,
      activityId,
      day: readInteger(raw["day"], 0, 6, 0),
      start: clamp(snap(readInteger(raw["start"], 0, DAY, 540)), 0, DAY - SLOT),
      length: clamp(snap(readInteger(raw["length"], SLOT, MAX_LENGTH, 60)), SLOT, MAX_LENGTH),
    };
    plan.blocks.push(block);
  }

  plan.dayStart = readInteger(input["dayStart"], 0, 12, 7);
  plan.dayEnd = readInteger(input["dayEnd"], 13, 24, 22);
  plan.example = input["example"] === true;
  return plan;
}
