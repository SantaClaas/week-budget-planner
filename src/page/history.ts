import { createPath, read, type Page } from "./index.ts";

/** Where the change of page came from: a link in the app, or Back and Forward or the first load. */
type Cause = "link" | "history";

/** Whether a click is one the browser should handle itself: a new tab, a download, another site. */
function isLeftToBrowser(event: MouseEvent, link: HTMLAnchorElement): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target !== "" ||
    link.hasAttribute("download") ||
    link.origin !== location.origin
  );
}

/**
 * Shows the page for the address now and after every change, turning clicks on the app's own links
 * into `pushState` instead of a load (see Pages and URLs in docs/spec/layout.md). Another spelling
 * of a page's path is replaced with its own; a path with no page shows "not-found" and keeps the
 * address, so the user sees what was wrong.
 * @mustUse Gives back the function that stops following the address.
 */
export function follow(base: string, show: (page: Page, cause: Cause) => void): () => void {
  function showCurrent(cause: Cause): void {
    const page = read(location.pathname, base) ?? "not-found";
    if (page !== "not-found" && location.pathname !== createPath(page, base)) {
      history.replaceState(null, "", `${createPath(page, base)}${location.search}${location.hash}`);
    }
    show(page, cause);
  }

  const onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (link === null || isLeftToBrowser(event, link)) return;
    if (read(link.pathname, base) === undefined) return;
    event.preventDefault();
    if (link.href === location.href) return;
    history.pushState(null, "", link.href);
    showCurrent("link");
  };
  const onPopState = (): void => {
    showCurrent("history");
  };

  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPopState);
  showCurrent("history");
  return () => {
    document.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPopState);
  };
}
