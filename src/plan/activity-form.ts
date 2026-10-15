import { snap } from "./time";
import { SLOT, type Mode } from "./types";

export type ActivityFormInput = {
  name: string;
  /** As typed: "1.5", "1,5", "2". */
  hours: string;
  mode: Mode;
  /** As typed, used only per day. */
  days: string;
};

export type ActivityFormResult =
  | { ok: true; value: { name: string; budgetMinutes: number; mode: Mode; days: number } }
  | { ok: false; field: "name" | "hours" | "days"; message: string };

/** Validates the activity form with the prototype's messages. Hours round to the slot. */
export function readActivityForm(input: ActivityFormInput): ActivityFormResult {
  const name = input.name.trim();
  const hours = Number.parseFloat(input.hours.replace(",", "."));
  const days = Number.parseInt(input.days, 10);
  if (!name) return { ok: false, field: "name", message: "Give the activity a name." };
  if (!(hours > 0)) {
    return { ok: false, field: "hours", message: "Enter the hours it needs, for example 1.5." };
  }
  if (input.mode === "day" && hours > 24) {
    return { ok: false, field: "hours", message: "A day has 24 hours. Enter 24 or less." };
  }
  if (input.mode === "week" && hours > 168) {
    return { ok: false, field: "hours", message: "A week has 168 hours. Enter 168 or less." };
  }
  if (input.mode === "day" && !(days >= 1 && days <= 7)) {
    return { ok: false, field: "days", message: "Enter how many days per week, from 1 to 7." };
  }
  return {
    ok: true,
    value: {
      name: name.slice(0, 60),
      budgetMinutes: Math.max(SLOT, snap(hours * 60)),
      mode: input.mode,
      days: input.mode === "day" ? days : 5,
    },
  };
}
