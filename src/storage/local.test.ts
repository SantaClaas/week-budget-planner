import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example.ts";
import * as local from "./local.ts";
import { PLAN_KEY } from "./local.ts";
import { createPredictableIds } from "../plan/test-data.ts";

const NOW = Temporal.Instant.from("2026-10-15T08:00:00Z");

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  clear() {
    this.#items.clear();
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
}

const events = () => {
  const target = new EventTarget();
  return Object.assign(target, {
    dispatchStorage(key: string | null) {
      // Node has no StorageEvent, so a plain event carries the key.
      target.dispatchEvent(Object.assign(new Event("storage"), { key }));
    },
  });
};

const example = () => createExampleWeek(NOW, createPredictableIds());
/** The value of a Result the test expects to have one. */
function readValue<Value>(result: Value | "newer-version"): Value {
  if (result === "newer-version") throw new Error("The store answered newer-version.");
  return result;
}

const file = (text: string, name: string) =>
  new File([text], name, { type: name.endsWith(".json") ? "application/json" : "" });

describe("localStorage store", () => {
  it("starts empty, then keeps what was saved", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    expect(await store.load()).toMatchObject({ isStored: false });
    expect(await store.save(undefined, example(), NOW)).toBe("saved");
    expect(await local.create(storage, events()).load()).toEqual({
      plan: example(),
      isStored: true,
    });
  });

  it("exports and imports .json and refuses .db files", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    expect(await store.save(undefined, example(), NOW)).toBe("saved");
    const exported = readValue(await store.exportFile());
    expect(exported.filename).toMatch(/^week-budget-planner-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(await store.wipe()).toBe("wiped");
    expect(storage.getItem(PLAN_KEY)).toBeNull();
    expect(await store.importFile(file(await exported.blob.text(), "backup.json"))).toBe(
      "imported",
    );
    expect(readValue(await store.load()).plan).toEqual(example());
    expect(await store.importFile(file("SQLite", "backup.db"))).toBe("needs-database");
  });

  it("refuses a .json file that isn't a plan and keeps the stored plan", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    expect(await store.save(undefined, example(), NOW)).toBe("saved");
    expect(await store.importFile(file('{"name": "notes"}', "notes.json"))).toBe("invalid-file");
    expect(await store.importFile(file("{broken", "broken.json"))).toBe("invalid-file");
    expect(await store.importFile(file('{"version": 2}', "newer.json"))).toBe("newer-version");
    expect(readValue(await store.load()).plan).toEqual(example());
  });

  it("leaves a plan saved by a newer version alone", async () => {
    const storage = new MemoryStorage();
    const newer = JSON.stringify({ version: 2, activities: [{ id: "a", name: "Unknown to us" }] });
    storage.setItem(PLAN_KEY, newer);
    const store = local.create(storage, events());
    expect(await store.load()).toBe("newer-version");
    expect(await store.save(undefined, example(), NOW)).toBe("newer-version");
    expect(await store.exportFile()).toBe("newer-version");
    expect(storage.getItem(PLAN_KEY)).toBe(newer);
  });

  it("stops saving once another tab saved with a newer version", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    expect(await store.save(undefined, example(), NOW)).toBe("saved");
    const newer = JSON.stringify({ version: 2 });
    storage.setItem(PLAN_KEY, newer);
    expect(await store.save(example(), example(), NOW)).toBe("newer-version");
    expect(storage.getItem(PLAN_KEY)).toBe(newer);
  });

  it("reports changes from other tabs", () => {
    const target = events();
    const store = local.create(new MemoryStorage(), target);
    let calls = 0;
    const stop = store.onExternalChange(() => {
      calls++;
    });
    target.dispatchStorage(PLAN_KEY);
    target.dispatchStorage("something-else");
    stop();
    target.dispatchStorage(PLAN_KEY);
    expect(calls).toBe(1);
  });
});
