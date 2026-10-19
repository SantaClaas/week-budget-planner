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
  await Promise.all(loading);
}
