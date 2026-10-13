import { connect } from "@tursodatabase/database";
import { describe, expect, it } from "vitest";

import exampleWeek from "../../examples/example-week.json";
import { sanitizePlan } from "../plan/sanitize";
import type { Plan } from "../plan/types";
import { localQueryService, type TursoConnection } from "./connection";
import { createDb, type Db } from "./drizzle";
import { MIGRATIONS, runMigrations } from "./migrations";
import { loadPlan, loadTheme, planStatements, savePlan, saveTheme } from "./plan-repository";
import { blocks as blocksTable } from "./schema";

/** A migrated in-memory database behind the same proxy path the app uses. */
async function openTestDb(): Promise<{ db: Db; connection: TursoConnection }> {
  const connection = (await connect(":memory:")) as unknown as TursoConnection;
  await runMigrations(connection);
  return { db: createDb(localQueryService(async () => connection)), connection };
}

const example = (): Plan => sanitizePlan(exampleWeek);

describe("migrations", () => {
  it("bundles the generated migrations", () => {
    expect(Object.keys(MIGRATIONS).length).toBeGreaterThan(0);
    for (const key of Object.keys(MIGRATIONS)) expect(key).toMatch(/^\d{14}_/);
  });

  it("can run again on a migrated database", async () => {
    const connection = (await connect(":memory:")) as unknown as TursoConnection;
    await runMigrations(connection);
    await runMigrations(connection);
  });
});

describe("plan repository", () => {
  it("reports a fresh database as not stored", async () => {
    const { db } = await openTestDb();
    const { plan, stored } = await loadPlan(db);
    expect(stored).toBe(false);
    expect(plan.activities).toEqual([]);
    expect(plan.dayStart).toBe(7);
  });

  it("round-trips a plan", async () => {
    const { db } = await openTestDb();
    await savePlan(db, undefined, example());
    const { plan, stored } = await loadPlan(db);
    expect(stored).toBe(true);
    expect(plan).toEqual(example());
  });

  it("writes only what changed", async () => {
    const { db } = await openTestDb();
    const before = example();
    await savePlan(db, undefined, before);
    const after: Plan = {
      ...before,
      blocks: before.blocks.map((block) => (block.id === "b1" ? { ...block, start: 660 } : block)),
    };
    expect(planStatements(db, before, after)).toHaveLength(1);
    expect(planStatements(db, before, before)).toHaveLength(0);
    await savePlan(db, before, after);
    expect((await loadPlan(db)).plan).toEqual(after);
  });

  it("deletes an activity together with its blocks", async () => {
    const { db } = await openTestDb();
    const before = example();
    await savePlan(db, undefined, before);
    const after: Plan = {
      ...before,
      activities: before.activities.filter((activity) => activity.id !== "gym"),
      blocks: before.blocks.filter((block) => block.act !== "gym"),
    };
    await savePlan(db, before, after);
    const { plan } = await loadPlan(db);
    expect(plan.activities.map((activity) => activity.id)).not.toContain("gym");
    expect(plan.blocks.some((block) => block.act === "gym")).toBe(false);
  });

  it("keeps the list order when activities move", async () => {
    const { db } = await openTestDb();
    const before = example();
    await savePlan(db, undefined, before);
    const after: Plan = { ...before, activities: [...before.activities].reverse() };
    await savePlan(db, before, after);
    expect((await loadPlan(db)).plan.activities.map((activity) => activity.id)).toEqual(
      after.activities.map((activity) => activity.id),
    );
  });

  it("rolls the whole action back when one statement fails", async () => {
    const { db } = await openTestDb();
    const before = example();
    await savePlan(db, undefined, before);
    const after: Plan = { ...before, dayStart: 6 };
    const [settingsUpdate] = planStatements(db, before, after);
    // A duplicate primary key makes the second statement fail after the first one ran.
    const duplicate = db.insert(blocksTable).values({
      id: "b1",
      activityId: "stats",
      day: 0,
      start: 0,
      dur: 15,
    });
    await expect(db.batch([settingsUpdate!, duplicate])).rejects.toThrow();
    expect((await loadPlan(db)).plan.dayStart).toBe(7);
  });

  it("stores the theme without touching the plan", async () => {
    const { db } = await openTestDb();
    expect(await loadTheme(db)).toBe("system");
    await savePlan(db, undefined, example());
    await saveTheme(db, "dark");
    expect(await loadTheme(db)).toBe("dark");
    expect((await loadPlan(db)).plan).toEqual(example());
  });
});
