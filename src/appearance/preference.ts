/**
 * One of the Appearance settings (Theme, Contrast, Motion; see Settings page in
 * docs/spec/layout.md): follow the system, or a choice of its own. Each mirrors a browser setting,
 * so it's a device preference: it lives in localStorage, not in the database, and the inline script
 * in index.html applies it before the first paint. System removes the stored entry, so the page
 * follows the browser again.
 */

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function findStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** A setting's choices, how it's stored and how it's applied to the page. */
type Options<Choice extends string, Target> = {
  /** The localStorage key, which the inline script in index.html reads too. */
  key: string;
  choices: readonly Choice[];
  /** The choice that follows the system, stored by removing the entry. */
  system: Choice;
  /** What the choice is applied to: the color-scheme meta, or the root element. */
  findTarget: () => Target | undefined;
  apply: (target: Target, choice: Choice) => void;
};

/** A setting's stored choice, and the ways to change it and follow it. */
export type Preference<Choice extends string, Target> = {
  choices: readonly Choice[];
  /** The stored choice, or the system's when nothing valid is stored or storage is blocked. */
  read: (storage?: PreferenceStorage) => Choice;
  /** Stores the choice and applies it. Applies even when storage is blocked. */
  save: (choice: Choice, storage?: PreferenceStorage, target?: Target) => void;
  /**
   * Follows a choice made in another tab.
   * @mustUse Gives back the function that stops listening.
   */
  listenForChanges: (
    callback: (choice: Choice) => void,
    events?: Pick<Window, "addEventListener" | "removeEventListener">,
    storage?: PreferenceStorage,
    target?: Target,
  ) => () => void;
};

/** A setting stored under `key`, applied with `apply`. */
export function create<Choice extends string, Target>(
  options: Options<Choice, Target>,
): Preference<Choice, Target> {
  const isChoice = (value: string | null | undefined): value is Choice =>
    options.choices.some((choice) => choice === value);

  function read(storage = findStorage()): Choice {
    let stored: string | null | undefined;
    try {
      stored = storage?.getItem(options.key);
    } catch {
      return options.system;
    }
    return isChoice(stored) ? stored : options.system;
  }

  function apply(choice: Choice, target = options.findTarget()): void {
    if (target !== undefined) options.apply(target, choice);
  }

  function store(choice: Choice, storage: PreferenceStorage | undefined): void {
    if (choice === options.system) {
      storage?.removeItem(options.key);
      return;
    }
    storage?.setItem(options.key, choice);
  }

  function save(choice: Choice, storage = findStorage(), target = options.findTarget()): void {
    try {
      store(choice, storage);
    } catch {
      // Blocked storage: the choice lasts until the tab closes.
    }
    apply(choice, target);
  }

  function listenForChanges(
    callback: (choice: Choice) => void,
    events: Pick<Window, "addEventListener" | "removeEventListener"> = window,
    storage = findStorage(),
    target = options.findTarget(),
  ): () => void {
    const listener = (event: StorageEvent) => {
      if (event.key !== null && event.key !== options.key) return;
      const choice = read(storage);
      apply(choice, target);
      callback(choice);
    };
    events.addEventListener("storage", listener);
    return () => {
      events.removeEventListener("storage", listener);
    };
  }

  return { choices: options.choices, read, save, listenForChanges };
}
