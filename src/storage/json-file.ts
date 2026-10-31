import { randomIds } from "../plan/id.ts";
import * as planFile from "../plan/file.ts";
import type { Plan } from "../plan/index.ts";
import type { Result } from "../result.ts";
import { createExportName, type ExportedFile, type ImportProblem } from "./plan-store.ts";

/** The plan as a `.json` file, the export below the full level. */

export const isJson = (file: File): boolean =>
  file.name.toLowerCase().endsWith(".json") || file.type === "application/json";

export function create(plan: Plan, today: Temporal.PlainDate): ExportedFile {
  return {
    blob: new Blob([planFile.serialize(plan)], { type: "application/json" }),
    filename: createExportName(today, "json"),
  };
}

/** Reads an imported `.json` plan file, or says why it isn't one this app can import. */
export async function read(file: File): Promise<Result<Plan, ImportProblem>> {
  if (!isJson(file)) return "needs-database";
  const plan = planFile.read(await file.text(), randomIds);
  return plan === "not-a-plan" ? "invalid-file" : plan;
}
