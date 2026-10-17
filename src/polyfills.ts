/**
 * Loads the polyfills the app needs from its first frame, and only in browsers that lack the
 * feature, so the others never download them. Each import becomes its own chunk (see
 * docs/LOADING.md and Browser support in docs/SPEC.md). Both are loaded in parallel.
 */
export async function loadPolyfills(): Promise<void> {
  const loading: Promise<unknown>[] = [];
  if (!("Temporal" in globalThis)) loading.push(import("temporal-polyfill/global"));
  if (!("DurationFormat" in Intl)) loading.push(import("@formatjs/intl-durationformat/polyfill.js"));
  await Promise.all(loading);
}
