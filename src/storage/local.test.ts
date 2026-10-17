import { describe, expect, it } from "vitest";

import { createExampleWeek } from "../plan/example";
import * as local from "./local";
import { PLAN_KEY } from "./local";
import { InvalidFileError, NewerVersionError } from "./plan-store";

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
      const event = new Event("storage") as Event & { key: string | null };
      Object.defineProperty(event, "key", { value: key });
      target.dispatchEvent(event);
    },
  });
};

const example = () => createExampleWeek(Temporal.Instant.from("2026-10-15T08:00:00Z"));
const file = (text: string, name: string) => new File([text], name, { type: name.endsWith(".json") ? "application/json" : "" });

describe("localStorage store", () => {
  it("starts empty, then keeps what was saved", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    expect(await store.load()).toMatchObject({ isStored: false });
    await store.save(undefined, example());
    expect(await local.create(storage, events()).load()).toEqual({ plan: example(), isStored: true });
  });

  it("exports and imports .json and refuses .db files", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    await store.save(undefined, example());
    const exported = await store.exportFile();
    expect(exported.filename).toMatch(/^week-budget-planner-\d{4}-\d{2}-\d{2}\.json$/);
    await store.wipe();
    expect(storage.getItem(PLAN_KEY)).toBeNull();
    await store.importFile(file(await exported.blob.text(), "backup.json"));
    expect((await store.load()).plan).toEqual(example());
    await expect(store.importFile(file("SQLite", "backup.db"))).rejects.toThrow(InvalidFileError);
  });

  it("refuses a .json file that isn't a plan and keeps the stored plan", async () => {
    const storage = new MemoryStorage();
    const store = local.create(storage, events());
    await store.save(undefined, example());
    await expect(store.importFile(file('{"name": "notes"}', "notes.json"))).rejects.toThrow(InvalidFileError);
    await expect(store.importFile(file("{broken", "broken.json"))).rejects.toThrow(InvalidFileError);
    await expect(store.importFile(file('{"version": 2}', "newer.json"))).rejects.toThrow(NewerVersionError);
    expect((await store.load()).plan).toEqual(example());
  });

  it("reports changes from other tabs", async () => {
    const target = events();
    const store = local.create(new MemoryStorage(), target);
    let calls = 0;
    const stop = store.onExternalChange(() => calls++);
    target.dispatchStorage(PLAN_KEY);
    target.dispatchStorage("something-else");
    stop();
    target.dispatchStorage(PLAN_KEY);
    expect(calls).toBe(1);
  });
});
