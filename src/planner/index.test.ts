import { createRoot, flush } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createBlock } from "../plan/test-data.ts";
import * as snackbar from "../snackbar/index.ts";
import * as memory from "../storage/memory.ts";
import { NewerVersionError, type PlanStore } from "../storage/plan-store.ts";
import { create, type Planner } from "./index.ts";

/**
 * A memory store that records each save, fails while `isFailing` is set, and lets the test play
 * another tab: `saveInOtherTab` stores a plan and says so, as another tab's save would.
 */
function createRecordingStore() {
  const store = memory.create();
  const saves: { before: Plan | undefined; after: Plan }[] = [];
  let onOtherTab: (() => void) | undefined;
  const recording = {
    saves,
    isFailing: false,
    isFromNewerVersion: false,
    async saveInOtherTab(plan: Plan): Promise<void> {
      await store.save(undefined, plan, Temporal.Now.instant());
      onOtherTab?.();
    },
    store: {
      ...store,
      level: "full",
      load() {
        if (!recording.isFromNewerVersion) return store.load();
        return Promise.reject(new NewerVersionError("Saved by a newer version."));
      },
      async save(before, after, now) {
        if (recording.isFailing) throw new Error("The disk is full.");
        saves.push({ before, after });
        await store.save(before, after, now);
      },
      onExternalChange(callback) {
        onOtherTab = callback;
        return () => {
          onOtherTab = undefined;
        };
      },
    } satisfies PlanStore,
  };
  return recording;
}

/** A planner in a reactive root, as the app has one, which goes when the test's scope ends. */
function openPlanner(
  store: PlanStore,
  onNewerVersion = (): void => {},
): { planner: Planner } & Disposable {
  return createRoot((dispose) => {
    const planner = create(store, createEmptyPlan(), { onNewerVersion });
    return {
      planner,
      [Symbol.dispose]: () => {
        planner.stop();
        dispose();
      },
    };
  });
}

/** Waits until every save so far has run. */
async function settle(): Promise<void> {
  const timer = Promise.withResolvers<void>();
  setTimeout(timer.resolve);
  await timer.promise;
  flush();
}

const addBlock = (plan: Plan): Plan => ({ ...plan, blocks: [...plan.blocks, createBlock()] });

describe("the planner", () => {
  it("saves each change from the plan the previous one left", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    planner.change(addBlock);
    planner.change(addBlock);
    flush();
    expect(planner.saveStatus().text).toBe("Saving…");
    await settle();
    expect(recording.saves).toHaveLength(2);
    expect(recording.saves[1]?.before).toBe(recording.saves[0]?.after);
    expect(planner.plan().blocks).toHaveLength(2);
    expect(planner.saveStatus().text).toBe("Saved in this browser");
  });

  it("undoes a change and saves the plan before it", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    planner.change(addBlock);
    flush();
    expect(planner.canUndo()).toBe(true);
    planner.undo();
    flush();
    expect(planner.plan().blocks).toHaveLength(0);
    expect(planner.canUndo()).toBe(false);
    await settle();
    expect(recording.saves.at(-1)?.after.blocks).toHaveLength(0);
  });

  it("records no step when nothing changed", () => {
    using opened = openPlanner(createRecordingStore().store);
    const { planner } = opened;
    planner.change((plan) => plan);
    flush();
    expect(planner.canUndo()).toBe(false);
  });

  it("keeps a change that failed to save on screen, and saves it on Retry", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    recording.isFailing = true;
    planner.change(addBlock);
    await settle();
    expect(planner.plan().blocks).toHaveLength(1);
    expect(planner.saveStatus().text).toBe("Not saved");
    const shown = snackbar.current();
    expect(shown?.message).toBe("Couldn't save your last change. It's still on screen.");
    recording.isFailing = false;
    shown?.action?.run();
    await settle();
    expect(recording.saves.at(-1)?.after.blocks).toHaveLength(1);
    expect(planner.saveStatus().text).toBe("Saved in this browser");
  });

  it("shows what another tab saved, and forgets the undo steps", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    planner.change(addBlock);
    await settle();
    await recording.saveInOtherTab(addBlock(addBlock(createEmptyPlan())));
    await settle();
    expect(planner.plan().blocks).toHaveLength(2);
    expect(planner.canUndo()).toBe(false);
  });

  it("changes nothing once a tab on a newer version took over, and says so", async () => {
    const recording = createRecordingStore();
    let isTold = false;
    using opened = openPlanner(recording.store, () => {
      isTold = true;
    });
    const { planner } = opened;
    recording.isFromNewerVersion = true;
    await recording.saveInOtherTab(createEmptyPlan());
    await settle();
    expect(isTold).toBe(true);
    planner.change(addBlock);
    flush();
    expect(planner.plan().blocks).toHaveLength(0);
    expect(planner.saveStatus().text).toBe("Not saved");
  });
});
