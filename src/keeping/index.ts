/**
 * Keeping the plan (see Keeping the data in docs/spec/persistence.md): when to ask the user whether
 * the browser should keep it, asking the browser from their click, and exporting a copy, which is
 * the way to keep it when the browser won't.
 */
import { downloadBlob } from "../download.ts";
import type { Plan } from "../plan/index.ts";
import * as snackbar from "../snackbar/index.ts";
import * as persistence from "../storage/persistence.ts";
import type { PlanStore, StorageLevel } from "../storage/plan-store.ts";

/** Holds when the user answered the card, so it doesn't come back. Read by nothing else. */
const ANSWERED_KEY = "week-budget-planner.keep-plan-dismissed-at";

type AnswerStorage = Pick<Storage, "getItem" | "setItem">;

function findStorage(): AnswerStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Whether the user answered the card already, with Not now or Keep it. */
export function isAnswered(storage = findStorage()): boolean {
  let answeredAt: string | null | undefined;
  try {
    answeredAt = storage?.getItem(ANSWERED_KEY);
  } catch {
    return false;
  }
  return answeredAt !== null && answeredAt !== undefined;
}

/** Stores when the user answered the card, so it doesn't come back. */
export function markAnswered(now: Temporal.Instant, storage = findStorage()): void {
  try {
    storage?.setItem(ANSWERED_KEY, now.toString());
  } catch {
    // Blocked storage: the card stays away until the tab closes, since the caller hides it too.
  }
}

/**
 * Whether to ask the user about keeping their plan: once they made a plan of their own, worth
 * keeping (the example week is gone, and it has activities), while the browser may delete it and
 * hasn't said no, until they answer. Never without storage, where there's nothing to keep.
 */
export const isAskDue = (situation: {
  plan: Pick<Plan, "activities" | "exampleLoadedAt">;
  level: StorageLevel;
  state: persistence.KeepingState | undefined;
  isAnswered: boolean;
}): boolean =>
  situation.level !== "none" &&
  situation.plan.exampleLoadedAt === null &&
  situation.plan.activities.length > 0 &&
  situation.state === "not-persisted" &&
  !situation.isAnswered;

/** Downloads the plan: the `.db` file at the full level, the `.json` plan file below it. */
export async function exportPlan(store: PlanStore): Promise<void> {
  let exported: Awaited<ReturnType<PlanStore["exportFile"]>>;
  try {
    // The export's one `now`: its name says when it was made.
    exported = await store.exportFile(Temporal.Now.plainDateTimeISO());
  } catch (error) {
    console.error("[keeping] couldn't export the plan", error);
    snackbar.show({ message: "Couldn't export your plan. Try again." });
    return;
  }
  // A newer version took over in another tab, which this tab already says.
  if (exported === "newer-version") return;
  downloadBlob(exported.blob, exported.filename);
}

/**
 * Asks the browser to keep the plan, only ever from the user's own click, says in a snackbar what
 * it answered (with Export when it said no), and gives back what it does now.
 */
export async function ask(store: PlanStore): Promise<persistence.KeepingState> {
  const isKept = await persistence.request();
  snackbar.show(
    isKept
      ? { message: "This browser will keep your plan." }
      : {
          message:
            "This browser didn't agree to keep your plan. Export now and then to keep a copy.",
          action: {
            label: "Export",
            run: () => {
              // exportPlan() reports its own failure.
              void exportPlan(store);
            },
          },
        },
  );
  return persistence.findState();
}
