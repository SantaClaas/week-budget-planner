import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseSync, Visitor, type HtmlTagDescriptor, type Plugin } from "vite";

/**
 * The Content Security Policy and Trusted Types (see docs/spec/security.md).
 *
 * - Adds the policy as a `<meta>` to the built `index.html`, with hashes of its inline scripts.
 * - Fails the build when `content-security-policy.txt`, the same policy as a header that the server
 *   compiles in (crates/server), is out of date: `pnpm policy` writes it.
 * - Puts the HTML the page may write on the allowlist of the default Trusted Types policy in
 *   `src/trusted-html.ts`: every template the Solid compiler produced, and the listed files.
 * - Fails the build when other code imports `src/trusted-html.ts`.
 * - In development, sends the Trusted Types part as a report-only header.
 */

/** The page's Trusted Types policies: `default` in src/trusted-html.ts, `service-worker` in index.html. */
const TRUSTED_TYPES = "require-trusted-types-for 'script'; trusted-types default service-worker";

const TRUSTED_HTML_MODULE = "src/trusted-html.ts";
/** The only file that may import the module, and only to create the policy before anything else. */
const ENTRY_MODULE = "src/index.tsx";

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["'][^"']*trusted-html(?:\.ts)?["']/u;
const INLINE_SCRIPT_PATTERN = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gu;

function buildPolicy(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...scriptHashes.map((hash) => `'${hash}'`), "'wasm-unsafe-eval'"].join(" ")}`,
    // Inline style attributes are part of Solid templates and the icon sprite.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    TRUSTED_TYPES,
  ].join("; ");
}

/**
 * The policy as a header, at the project's root, committed: the server compiles it in, so it builds
 * without the app having been built first.
 */
const HEADER_FILE = "content-security-policy.txt";

/**
 * The page's policy as a header: the `<meta>` policy with `frame-ancestors 'none'`, which only a
 * header can carry.
 */
export const buildHeaderPolicy = (metaPolicy: string): string =>
  `${metaPolicy}; frame-ancestors 'none'`;

/** The policy as the first element of a page's `<head>`. */
const createMetaTag = (policy: string): HtmlTagDescriptor[] => [
  {
    tag: "meta",
    attrs: { "http-equiv": "Content-Security-Policy", content: policy },
    injectTo: "head-prepend",
  },
];

const hashScript = (script: string) =>
  `sha256-${createHash("sha256").update(script).digest("base64")}`;

/** The page's policy for its `<meta>`: its inline scripts' hashes, and the fixed directives. */
export const buildPagePolicy = (html: string): string =>
  buildPolicy(
    html
      .matchAll(INLINE_SCRIPT_PATTERN)
      .map(([, script = ""]) => hashScript(script))
      .toArray(),
  );

/** The static HTML of every Solid `template()` call in compiled code, as the runtime receives it. */
export function findTemplates(code: string): string[] {
  if (!code.includes("@solidjs/web")) return [];

  const { program } = parseSync("module.js", code, { lang: "js" });
  const templates: string[] = [];
  let templateName: string | undefined;
  new Visitor({
    ImportDeclaration(node) {
      if (node.source.value !== "@solidjs/web") return;

      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          "name" in specifier.imported &&
          specifier.imported.name === "template"
        ) {
          templateName = specifier.local.name;
        }
      }
    },
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== templateName) return;

      const html = node.arguments[0];
      if (html?.type === "Literal" && typeof html.value === "string") {
        templates.push(html.value);
        return;
      }

      if (html?.type !== "TemplateLiteral" || html.expressions.length > 0) {
        throw new Error(
          "A Solid template() call without a static string can't be put on the Trusted Types allowlist.",
        );
      }

      const cooked = html.quasis[0]?.value.cooked;
      if (typeof cooked === "string") templates.push(cooked);
    },
  }).visit(program);
  return templates;
}

const isOwnCode = (id: string) => !id.startsWith("\0") && !id.includes("/node_modules/");

/**
 * The plugins that add the Content Security Policy and Trusted Types.
 *
 * @param options - What the build can't find by itself.
 * @param options.trustedHtmlFiles - Files, relative to the project root, that are imported with
 *   `?raw` and written as HTML.
 */
export function addContentSecurityPolicy({
  trustedHtmlFiles = [],
}: { trustedHtmlFiles?: string[] } = {}): Plugin[] {
  let root = process.cwd();
  const formatRelativePath = (id: string) =>
    path
      .relative(root, id.split("?")[0] ?? id)
      .split(path.sep)
      .join("/");

  return [
    {
      name: "content-security-policy:guard",
      enforce: "pre",
      configResolved(config) {
        root = config.root;
      },
      transform(code, id) {
        if (!isOwnCode(id)) return;

        const file = formatRelativePath(id);
        if (file === TRUSTED_HTML_MODULE || file === ENTRY_MODULE) return;

        if (IMPORT_PATTERN.test(code)) {
          this.error(
            `${file} imports ${TRUSTED_HTML_MODULE}. Only the build may allow HTML (see docs/spec/security.md). Show user text as text instead.`,
          );
        }
      },
    },
    {
      name: "content-security-policy",
      // After the Solid compiler, so the templates are in the code.
      enforce: "post",
      config: () => ({
        server: { headers: { "Content-Security-Policy-Report-Only": TRUSTED_TYPES } },
      }),
      transform(code, id) {
        // Libraries count too: a prebuilt Solid component library ships template() calls as well.
        if (id.startsWith("\0")) return null;

        const file = formatRelativePath(id);
        const isTrustedFile = id.includes("?raw") && trustedHtmlFiles.includes(file);
        const html = isTrustedFile
          ? [readFileSync(path.join(root, file), "utf8")]
          : findTemplates(code);
        if (html.length === 0) return null;

        // On the first line, so the source map of every other line stays right.
        const allow = `import { allowHtml } from "/${TRUSTED_HTML_MODULE}"; allowHtml(${JSON.stringify(html)}); `;
        return { code: allow + code, map: null };
      },
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          // Development has the report-only header instead: Vite's own scripts aren't hashed.
          if (context.server) return html;

          const metaPolicy = buildPagePolicy(html);
          // The header the server sends every page is the app's page's policy. Another page, such
          // as the transport check, has no inline scripts, so its own policy is stricter, and the
          // browser enforces both.
          if (path.basename(context.filename) !== "index.html") return createMetaTag(metaPolicy);

          const headerPolicy = readFileSync(path.join(root, HEADER_FILE), "utf8").trim();
          if (headerPolicy !== buildHeaderPolicy(metaPolicy)) {
            throw new Error(
              `${HEADER_FILE} doesn't match the page's inline scripts. Run pnpm policy to write it again.`,
            );
          }

          return createMetaTag(metaPolicy);
        },
      },
    },
  ];
}
