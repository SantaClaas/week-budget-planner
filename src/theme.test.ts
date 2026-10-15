import { describe, expect, it } from "vitest";

import * as theme from "./theme";

const createStorage = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};

const storageEvent = (key: string | null) => {
  const event = new Event("storage") as Event & { key: string | null };
  Object.defineProperty(event, "key", { value: key });
  return event;
};

describe("theme", () => {
  it("follows the system until a choice is stored", () => {
    const storage = createStorage();
    expect(theme.read(storage)).toBe("system");
    storage.setItem("week-budget-planner.theme", "sepia");
    expect(theme.read(storage)).toBe("system");
    expect(theme.read(undefined)).toBe("system");
  });

  it("stores light and dark, and removes the entry for system", () => {
    const storage = createStorage();
    const meta = { content: "light dark" };
    theme.save("dark", storage, meta);
    expect(theme.read(storage)).toBe("dark");
    expect(meta.content).toBe("dark");
    theme.save("system", storage, meta);
    expect(storage.items.size).toBe(0);
    expect(meta.content).toBe("light dark");
  });

  it("still applies the choice when storage is blocked", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const meta = { content: "light dark" };
    theme.save("light", blocked, meta);
    expect(meta.content).toBe("light");
    expect(theme.read(blocked)).toBe("system");
  });

  it("follows a choice made in another tab", () => {
    const storage = createStorage();
    const meta = { content: "light dark" };
    const events = new EventTarget();
    const seen: theme.Theme[] = [];
    const stop = theme.listenForChanges((next) => seen.push(next), events, storage, meta);
    storage.setItem("week-budget-planner.theme", "dark");
    events.dispatchEvent(storageEvent("week-budget-planner.theme"));
    events.dispatchEvent(storageEvent("something-else"));
    stop();
    events.dispatchEvent(storageEvent(null));
    expect(seen).toEqual(["dark"]);
    expect(meta.content).toBe("dark");
  });
});
