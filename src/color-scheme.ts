/**
 * The theme setting: follow the system, or always light or dark. It's a device preference, so it
 * lives in localStorage, not in the database, and the inline script in index.html applies it before
 * the first paint. Applying means setting the color-scheme meta, which the tokens map onto the
 * CSS color-scheme (see Design, Theme in docs/SPEC.md).
 */
const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/** Also read by the inline script in index.html. */
const STORAGE_KEY = "week-budget-planner.theme";

type ColorSchemeMeta = { content: string };

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function findStorage(): ThemeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const findMeta = (): ColorSchemeMeta | null =>
  globalThis.document?.querySelector<HTMLMetaElement>('meta[name="color-scheme"]') ?? null;

/** The stored choice. "system" when nothing valid is stored, or storage is blocked. */
export function read(storage: ThemeStorage | undefined = findStorage()): Theme {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Points the color-scheme meta at the choice. */
function apply(theme: Theme, meta = findMeta()): void {
  if (meta) meta.content = theme === "system" ? "light dark" : theme;
}

/**
 * Stores the choice and applies it. System removes the stored entry instead of storing "system",
 * so the page keeps following the system setting. Applies even when storage is blocked.
 */
export function save(
  theme: Theme,
  storage: ThemeStorage | undefined = findStorage(),
  meta = findMeta(),
): void {
  try {
    if (theme === "system") storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Blocked storage: the choice lasts until the tab closes.
  }
  apply(theme, meta);
}

/** Follows a choice made in another tab. Returns a function that stops listening. */
export function listenForChanges(
  callback: (theme: Theme) => void,
  events: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  storage: ThemeStorage | undefined = findStorage(),
  meta = findMeta(),
): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const theme = read(storage);
    apply(theme, meta);
    callback(theme);
  };
  events.addEventListener("storage", listener);
  return () => {
    events.removeEventListener("storage", listener);
  };
}
