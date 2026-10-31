import type { Plugin } from "vite";

/**
 * Copies the built `index.html` to `404.html`, which GitHub Pages serves for every path it doesn't
 * have, so a reload of a page's path such as `/week-budget-planner/activities` starts the app
 * there (see Hosting on GitHub Pages in docs/spec/persistence.md).
 */
export function notFoundPage(): Plugin {
  return {
    name: "week-budget-planner:not-found-page",
    apply: "build",
    // After Vite's own HTML plugin and every transformIndexHtml hook, so the copy is the final page.
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset") throw new Error("The build has no index.html to copy.");
      this.emitFile({ type: "asset", fileName: "404.html", source: page.source });
    },
  };
}
