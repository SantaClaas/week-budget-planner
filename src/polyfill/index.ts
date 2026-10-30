/**
 * Loads the polyfills the app needs from its first frame, and only in browsers that lack the
 * feature, so the others never download them. Each import becomes its own chunk (see
 * docs/LOADING.md and docs/spec/browser-support.md). They're loaded in parallel.
 */
export async function loadPolyfills(): Promise<void> {
  const loading: Promise<unknown>[] = [];
  if (!("Temporal" in globalThis)) loading.push(import("temporal-polyfill/global"));
  if (!("DurationFormat" in Intl))
    loading.push(import("@formatjs/intl-durationformat/polyfill.js"));
  // the iterator helpers (Chrome 122, Firefox 131, Safari 18.4), which the plan logic chains
  if (!("Iterator" in globalThis && "toArray" in Iterator.prototype))
    loading.push(import("core-js/es/iterator/index.js"));
  // `using` and AsyncDisposableStack, for cleanup (Chrome 134, Firefox 141, not yet in Safari).
  // The build lowers the `using` syntax itself, but not these symbols and classes.
  if (!("AsyncDisposableStack" in globalThis)) loading.push(import("./disposal.ts"));
  await Promise.all(loading);
}
