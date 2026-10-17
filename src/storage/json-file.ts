import * as planFile from "../plan/file";
import type { Plan } from "../plan/types";
import { InvalidFileError, NewerVersionError, type ExportedFile } from "./plan-store";

/** The plan as a `.json` file, the export below the full level. */

export const isJson = (file: File): boolean =>
  file.name.toLowerCase().endsWith(".json") || file.type === "application/json";

export function create(plan: Plan): ExportedFile {
  return {
    blob: new Blob([planFile.serialize(plan)], { type: "application/json" }),
    filename: `week-budget-planner-${Temporal.Now.plainDateISO().toString()}.json`,
  };
}

/** Reads an imported `.json` plan file. Refuses anything else, such as a `.db` file. */
export async function read(file: File): Promise<Plan> {
  if (!isJson(file)) {
    throw new InvalidFileError(
      "Only a .json plan file can be imported here, because this browser can't open the database.",
    );
  }
  const plan = planFile.read(await file.text());
  if (plan === "not-a-plan")
    throw new InvalidFileError(
      "This file isn't a Week Budget Planner plan, so nothing was changed.",
    );
  if (plan === "newer-version")
    throw new NewerVersionError(
      "This file is from a newer version of Week Budget Planner. Reload to update the app, then import it again.",
    );
  return plan;
}
