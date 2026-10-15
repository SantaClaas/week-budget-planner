import * as planFile from "../plan/file";
import type { Plan } from "../plan/types";
import type { ExportedFile } from "./plan-store";

/** The plan as a `.json` file, the export below the full level. */

export const isJson = (file: File): boolean =>
  file.name.toLowerCase().endsWith(".json") || file.type === "application/json";

export function create(plan: Plan): ExportedFile {
  return {
    blob: new Blob([planFile.serialize(plan)], { type: "application/json" }),
    filename: `week-budget-planner-${planFile.formatLocalDate()}.json`,
  };
}

/** Reads an imported `.json` plan file. Refuses anything else, such as a `.db` file. */
export async function read(file: File): Promise<Plan> {
  if (!isJson(file)) {
    throw new Error("Only a .json plan file can be imported here, because this browser can't open the database.");
  }
  return planFile.parse(await file.text());
}
