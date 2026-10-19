/// <reference types="vite/client" />

/** The app's version, from vite-plugins/app-version.ts. */
declare module "virtual:app-version" {
  const version: { date: string; commit?: string; url: string };
  export default version;
}

/** core-js ships no types. Its iterator entry only installs the helpers (see src/polyfills.ts). */
declare module "core-js/es/iterator/index.js";
