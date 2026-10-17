import { describe, expect, it } from "vitest";

import * as colorScheme from "./color-scheme.ts";

const createStorage = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};

// Node has no StorageEvent, so a plain event carries the key.
const storageEvent = (key: string | null): Event => Object.assign(new Event("storage"), { key });

describe("color scheme", () => {
  it("follows the system until a choice is stored", () => {
    const storage = createStorage();
    expect(colorScheme.read(storage)).toBe("light dark");
    storage.setItem("week-budget-planner.color-scheme", "sepia");
    expect(colorScheme.read(storage)).toBe("light dark");
    expect(colorScheme.read()).toBe("light dark");
  });

  it("stores light and dark, and removes the entry for system", () => {
    const storage = createStorage();
    const meta = { content: "light dark" };
    colorScheme.save("dark", storage, meta);
    expect(colorScheme.read(storage)).toBe("dark");
    expect(meta.content).toBe("dark");
    colorScheme.save("light dark", storage, meta);
    expect(storage.items.size).toBe(0);
    expect(meta.content).toBe("light dark");
  });

  it("still applies the choice when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const meta = { content: "light dark" };
    colorScheme.save("light", blocked, meta);
    expect(meta.content).toBe("light");
    expect(colorScheme.read(blocked)).toBe("light dark");
  });

  it("follows a choice made in another tab", () => {
    const storage = createStorage();
    const meta = { content: "light dark" };
    const events = new EventTarget();
    const seen: colorScheme.ColorScheme[] = [];
    const stop = colorScheme.listenForChanges(
      (next) => {
        seen.push(next);
      },
      events,
      storage,
      meta,
    );
    storage.setItem("week-budget-planner.color-scheme", "dark");
    events.dispatchEvent(storageEvent("week-budget-planner.color-scheme"));
    events.dispatchEvent(storageEvent("something-else"));
    stop();
    events.dispatchEvent(storageEvent(null));
    expect(seen).toEqual(["dark"]);
    expect(meta.content).toBe("dark");
  });
});
