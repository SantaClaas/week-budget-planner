import { localDate, parsePlan, serializePlan } from "../plan/file";
import type { Plan } from "../plan/types";
import type { ExportedFile } from "./plan-store";

/** The plan as a `.json` file, the export below the full level. */

export const isPlanJson = (file: File): boolean =>
  file.name.toLowerCase().endsWith(".json") || file.type === "application/json";

export function exportJsonFile(plan: Plan): ExportedFile {
  return {
    blob: new Blob([serializePlan(plan)], { type: "application/json" }),
    filename: `week-budget-planner-${localDate()}.json`,
  };
}

/** Reads an imported `.json` plan file. Refuses anything else, such as a `.db` file. */
export async function importJsonFile(file: File): Promise<Plan> {
  if (!isPlanJson(file)) {
    throw new Error("Only a .json plan file can be imported here, because this browser can't open the database.");
  }
  return parsePlan(await file.text());
}
