import { createRoot, flush } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEmptyPlan, type Plan } from "../plan/index.ts";
import { createActivity, createBlock } from "../plan/test-data.ts";
import type { Snackbar } from "../snackbar/index.ts";
import * as memory from "../storage/memory.ts";
import type { PlanStore } from "../storage/plan-store.ts";
import { create, type Planner } from "./index.ts";

/**
 * A memory store that records each save, fails while `isFailing` is set, answers "newer-version"
 * while `isFromNewerVersion` is set, and lets the test play another tab: `saveInOtherTab` stores a
 * plan and says so, as another tab's save would.
 */
type Recording = {
  saves: { before: Plan | undefined; after: Plan }[];
  isFailing: boolean;
  isFromNewerVersion: boolean;
  saveInOtherTab(plan: Plan): Promise<void>;
  store: PlanStore;
};

function createRecordingStore(): Recording {
  const store = memory.create();
  const saves: { before: Plan | undefined; after: Plan }[] = [];
  let onOtherTab: (() => void) | undefined;
  const recording: Recording = {
    saves,
    isFailing: false,
    isFromNewerVersion: false,
    async saveInOtherTab(plan: Plan): Promise<void> {
      expect(await store.save(undefined, plan, Temporal.Now.instant())).toBe("saved");
      onOtherTab?.();
    },
    store: {
      ...store,
      level: "full",
      load() {
        return recording.isFromNewerVersion ? Promise.resolve("newer-version") : store.load();
      },
      save(before, after, now) {
        if (recording.isFromNewerVersion) return Promise.resolve("newer-version");
        if (recording.isFailing) return Promise.reject(new Error("The disk is full."));
        saves.push({ before, after });
        return store.save(before, after, now);
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

type Options = Parameters<typeof create>[2];

/** A planner in a reactive root, as the app has one, which goes when the test's scope ends. */
function openPlanner(
  store: PlanStore,
  { showSnackbar = (): void => {}, onNewerVersion = (): void => {} }: Partial<Options> = {},
): { planner: Planner } & Disposable {
  return createRoot((dispose) => {
    const planner = create(store, createEmptyPlan(), { showSnackbar, onNewerVersion });
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
const addWork = (plan: Plan): Plan => ({ ...plan, activities: [createActivity()] });
const addOwnBlock = (plan: Plan): Plan => ({
  ...plan,
  blocks: [...plan.blocks, createBlock({ id: "mine" })],
});
const addOtherTabsBlock = (plan: Plan): Plan => ({
  ...plan,
  blocks: [...plan.blocks, createBlock({ id: "theirs", start: 900 })],
});

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

  it("shows a preview without saving it or recording a step, until the change ends it", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    // A drag shows each frame from the plan as it is, not from the frame before.
    planner.preview(addBlock);
    planner.preview(addBlock);
    flush();
    expect(planner.plan().blocks).toHaveLength(1);
    expect(planner.canUndo()).toBe(false);
    planner.endPreview();
    flush();
    expect(planner.plan().blocks).toHaveLength(0);
    await settle();
    expect(recording.saves).toHaveLength(0);

    // A drag let go where it started changes nothing, and the preview goes.
    planner.preview(addBlock);
    planner.change((plan) => plan);
    flush();
    expect(planner.plan().blocks).toHaveLength(0);
    expect(planner.canUndo()).toBe(false);

    // Releasing the drag saves the change from the plan as it is, as one step.
    planner.preview(addBlock);
    planner.change(addBlock);
    await settle();
    expect(planner.plan().blocks).toHaveLength(1);
    expect(recording.saves).toHaveLength(1);
    expect(planner.canUndo()).toBe(true);
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
    let shown: Snackbar | undefined;
    using opened = openPlanner(recording.store, {
      showSnackbar: (snackbar) => {
        shown = snackbar;
      },
    });
    const { planner } = opened;
    recording.isFailing = true;
    planner.change(addBlock);
    await settle();
    expect(planner.plan().blocks).toHaveLength(1);
    expect(planner.saveStatus().text).toBe("Not saved");
    expect(shown?.message).toBe("Couldn't save your last change. It's still on screen.");
    recording.isFailing = false;
    shown?.action?.run();
    await settle();
    expect(recording.saves.at(-1)?.after.blocks).toHaveLength(1);
    expect(planner.saveStatus().text).toBe("Saved in this browser");
  });

  it("keeps its undo steps when another tab saves, and undoes only its own change", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    planner.change(addWork);
    planner.change(addOwnBlock);
    await settle();
    await recording.saveInOtherTab(addOtherTabsBlock(planner.plan()));
    await settle();
    expect(planner.plan().blocks.map((block) => block.id)).toEqual(["mine", "theirs"]);
    expect(planner.canUndo()).toBe(true);
    planner.undo();
    flush();
    expect(planner.plan().blocks.map((block) => block.id)).toEqual(["theirs"]);
    await settle();
    expect(recording.saves.at(-1)?.after.blocks.map((block) => block.id)).toEqual(["theirs"]);
  });

  it("drops a step another tab changed the same things since, and says why", async () => {
    const recording = createRecordingStore();
    const snackbars: Snackbar[] = [];
    using opened = openPlanner(recording.store, {
      showSnackbar: (snackbar) => {
        snackbars.push(snackbar);
      },
    });
    const { planner } = opened;
    planner.change(addWork);
    planner.change(addOwnBlock);
    await settle();
    // The other tab deletes the block this tab added.
    await recording.saveInOtherTab({ ...planner.plan(), blocks: [] });
    await settle();
    const savesBefore = recording.saves.length;
    planner.undo();
    flush();
    expect(snackbars.at(-1)?.message).toBe("Couldn't undo: that changed in another tab.");
    expect(planner.plan().activities).toHaveLength(1);
    // The step went without a change, and the one before it is next.
    expect(planner.canUndo()).toBe(true);
    await settle();
    expect(recording.saves).toHaveLength(savesBefore);
  });

  it("stops when a save finds that a newer version took over", async () => {
    const recording = createRecordingStore();
    let isTold = false;
    using opened = openPlanner(recording.store, {
      onNewerVersion: () => {
        isTold = true;
      },
    });
    const { planner } = opened;
    recording.isFromNewerVersion = true;
    planner.change(addBlock);
    await settle();
    expect(isTold).toBe(true);
    expect(planner.saveStatus().text).toBe("Not saved");
    expect(planner.canUndo()).toBe(false);
    // The change wasn't saved, so it doesn't stay on screen as if it were.
    flush();
    expect(planner.plan().blocks).toHaveLength(0);
  });

  it("changes nothing once a tab on a newer version took over, and says so", async () => {
    const recording = createRecordingStore();
    let isTold = false;
    using opened = openPlanner(recording.store, {
      onNewerVersion: () => {
        isTold = true;
      },
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

  it("puts a drag back where it was saved when it ends after a newer version took over", async () => {
    const recording = createRecordingStore();
    using opened = openPlanner(recording.store);
    const { planner } = opened;
    planner.preview(addBlock);
    flush();
    expect(planner.plan().blocks).toHaveLength(1);
    recording.isFromNewerVersion = true;
    await recording.saveInOtherTab(createEmptyPlan());
    await settle();
    planner.change(addBlock);
    flush();
    expect(planner.plan().blocks).toHaveLength(0);
  });
});
