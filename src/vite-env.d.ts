/// <reference types="vite/client" />

/** The app's version, from vite-plugins/app-version.ts. */
declare module "virtual:app-version" {
  const version: {
    date: string;
    commit?: string;
    url: string;
    /** When the app was built, as an ISO 8601 instant in UTC to the second. */
    builtAt: string;
  };
  export default version;
}

/** core-js ships no types. These entries only install globals (see src/polyfill/index.ts). */
declare module "core-js/es/iterator/index.js";
declare module "core-js/es/promise/with-resolvers.js";
declare module "core-js/es/symbol/dispose.js";
declare module "core-js/es/symbol/async-dispose.js";
declare module "core-js/es/disposable-stack/index.js";
declare module "core-js/es/async-disposable-stack/index.js";

/**
 * Element-scoped View Transitions, which TypeScript's DOM types don't have yet (see
 * docs/spec/browser-support.md). Optional, since only Chromium has them, so a call checks first.
 */
interface Element {
  startViewTransition?: (update?: ViewTransitionUpdateCallback) => ViewTransition;
}
