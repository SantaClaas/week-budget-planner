/// <reference types="vite/client" />

/** The app's version, from vite-plugins/app-version.ts. */
declare module "virtual:app-version" {
  const version: { date: string; commit?: { hash: string; url: string } };
  export default version;
}
