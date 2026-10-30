/**
 * The color scheme the page uses, which the Settings page calls the theme: follow the system, or
 * always light or dark. The values are the CSS `color-scheme` values, and "light dark" follows the
 * system. It's a device preference, so it lives in localStorage, not in the database, and the inline
 * script in index.html applies it before the first paint. Applying means setting the color-scheme
 * meta, which the tokens map onto the CSS color-scheme (see Theme in docs/spec/design.md).
 */
export type ColorScheme = "light dark" | "light" | "dark";

/** Also read by the inline script in index.html. */
const STORAGE_KEY = "week-budget-planner.color-scheme";

type ColorSchemeMeta = { content: string };

type ColorSchemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function findStorage(): ColorSchemeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const findMeta = (): ColorSchemeMeta | null =>
  globalThis.document?.querySelector<HTMLMetaElement>('meta[name="color-scheme"]') ?? null;

/** The stored choice. "light dark" (follow the system) when nothing valid is stored, or storage is blocked. */
export function read(storage: ColorSchemeStorage | undefined = findStorage()): ColorScheme {
  let stored: string | null | undefined;
  try {
    stored = storage?.getItem(STORAGE_KEY);
  } catch {
    return "light dark";
  }
  return stored === "light" || stored === "dark" ? stored : "light dark";
}

/** Points the color-scheme meta at the choice. */
function apply(colorScheme: ColorScheme, meta = findMeta()): void {
  if (meta) meta.content = colorScheme;
}

/**
 * "light dark" removes the stored entry instead of storing it, so the page keeps following the
 * system setting.
 */
function store(colorScheme: ColorScheme, storage: ColorSchemeStorage | undefined): void {
  if (colorScheme === "light dark") {
    storage?.removeItem(STORAGE_KEY);
    return;
  }
  storage?.setItem(STORAGE_KEY, colorScheme);
}

/** Stores the choice and applies it. Applies even when storage is blocked. */
export function save(
  colorScheme: ColorScheme,
  storage: ColorSchemeStorage | undefined = findStorage(),
  meta = findMeta(),
): void {
  try {
    store(colorScheme, storage);
  } catch {
    // Blocked storage: the choice lasts until the tab closes.
  }
  apply(colorScheme, meta);
}

/** Follows a choice made in another tab. Returns a function that stops listening. */
export function listenForChanges(
  callback: (colorScheme: ColorScheme) => void,
  events: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  storage: ColorSchemeStorage | undefined = findStorage(),
  meta = findMeta(),
): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const colorScheme = read(storage);
    apply(colorScheme, meta);
    callback(colorScheme);
  };
  events.addEventListener("storage", listener);
  return () => {
    events.removeEventListener("storage", listener);
  };
}
