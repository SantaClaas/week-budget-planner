// Writes content-security-policy.txt: the page's Content Security Policy as a header, made from the
// inline scripts in index.html the same way the build makes the page's <meta> (see
// vite-plugins/content-security-policy.ts and docs/spec/security.md).
//
//   node scripts/build-content-security-policy.ts
//
// It's committed, so the server (crates/server) compiles it in and builds without the app being
// built first. Run it after changing an inline script: a test, and the build, fail until it's
// current.

import { readFileSync, writeFileSync } from "node:fs";

import { buildHeaderPolicy, buildPagePolicy } from "../vite-plugins/content-security-policy.ts";

/** The policy file's content, made from the source of index.html. */
export const buildPolicyFile = (indexHtml: string): string =>
  `${buildHeaderPolicy(buildPagePolicy(indexHtml))}\n`;

const INDEX = new URL("../index.html", import.meta.url);
/** The policy file, at the repository's root. */
export const POLICY_FILE = new URL("../content-security-policy.txt", import.meta.url);

if (import.meta.main) {
  writeFileSync(POLICY_FILE, buildPolicyFile(readFileSync(INDEX, "utf8")));
  console.log("Wrote content-security-policy.txt.");
}
