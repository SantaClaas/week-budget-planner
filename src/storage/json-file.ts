import * as planFile from "../plan/file";
import type { Plan } from "../plan/types";
import { InvalidFileError, type ExportedFile } from "./plan-store";

/** The plan as a `.json` file, the export below the full level. */

export const isJson = (file: File): boolean =>
  file.name.toLowerCase().endsWith(".json") || file.type === "application/json";

export function create(plan: Plan): ExportedFile {
  return {
    blob: new Blob([planFile.serialize(plan)], { type: "application/json" }),
    filename: `week-budget-planner-${Temporal.Now.plainDateISO()}.json`,
  };
}

/** Reads an imported `.json` plan file. Refuses anything else, such as a `.db` file. */
export async function read(file: File): Promise<Plan> {
  if (!isJson(file)) {
    throw new InvalidFileError("Only a .json plan file can be imported here, because this browser can't open the database.");
  }
  const plan = planFile.read(await file.text());
  if (!plan) throw new InvalidFileError("This file isn't a Week Budget Planner plan.");
  return plan;
}
