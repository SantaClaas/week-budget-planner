/// <reference types="vite/client" />

/** The app's version, from vite-plugins/app-version.ts. */
declare module "virtual:app-version" {
  const version: { date: string; commit?: string; url: string };
  export default version;
}

/** core-js ships no types. These entries only install globals (see src/polyfills/index.ts). */
declare module "core-js/es/iterator/index.js";
declare module "core-js/es/symbol/dispose.js";
declare module "core-js/es/symbol/async-dispose.js";
declare module "core-js/es/disposable-stack/index.js";
declare module "core-js/es/async-disposable-stack/index.js";
