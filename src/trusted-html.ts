/**
 * The page's default Trusted Types policy (see Security in docs/SPEC.md). With the page's Content
 * Security Policy, the browser calls it for every plain string written as HTML or loaded as a
 * script, and it lets through only:
 * - HTML the build allowed: the templates the Solid compiler produced and the files listed in
 *   vite.config.ts, registered by code that vite-plugins/content-security-policy.ts adds;
 * - same-origin script URLs, such as the database worker.
 * Everything else is a Trusted Types violation, so nothing can write untrusted HTML by mistake.
 * `src/index.tsx` imports this first, so the policy exists before anything else runs.
 */

/** The part of the Trusted Types API this uses. TypeScript's DOM types don't have it yet. */
declare global {
  var trustedTypes: TrustedTypePolicyFactory | undefined;
}

type TrustedTypePolicyFactory = {
  createPolicy(
    name: string,
    rules: {
      createHTML(input: string): string | null;
      createScriptURL(input: string): string | null;
    },
  ): unknown;
};

const allowedHtml = new Set<string>();

/** Lets these exact strings be written as HTML. Only code the build adds may call this. */
export function allowHtml(html: readonly string[]): void {
  for (const item of html) allowedHtml.add(item);
}

const isSameOrigin = (url: string) => new URL(url, document.baseURI).origin === location.origin;

globalThis.trustedTypes?.createPolicy("default", {
  // Returning null makes the browser refuse the string.
  createHTML: (input) => (allowedHtml.has(input) ? input : null),
  createScriptURL: (input) => (isSameOrigin(input) ? input : null),
});
