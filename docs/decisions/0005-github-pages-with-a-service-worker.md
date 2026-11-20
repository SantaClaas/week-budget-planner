# 0005 GitHub Pages, with a service worker for cross-origin isolation

**Status:** Accepted, 2026-10-15. To be replaced once the sync server serves the app: on 2026-11-13 it was decided that GitHub Pages is then dropped ([Hosting](../spec/network.md#hosting) in [Network](../spec/network.md)).

## Context

The app is a static site with no backend. Its database needs `SharedArrayBuffer`, so the page must be cross-origin isolated, with the headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (see [0002](0002-sqlite-in-the-browser.md)). The app also has paths of its own, such as `/activities`, that must survive a reload.

## Decision

Host the app on GitHub Pages, deployed by [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) on every push to `main`, and let the app's own service worker add the isolation headers ([Hosting on GitHub Pages](../spec/persistence.md#hosting-on-github-pages) in [Persistence](../spec/persistence.md)):

- [`public/service-worker.js`](../../public/service-worker.js) returns every response it handles with the headers added; a small inline script in [`index.html`](../../index.html) registers it and reloads once, with a `sessionStorage` flag against a loop;
- the build copies `index.html` to `404.html`, so the app starts on any of its paths;
- every file the page loads is served from the same origin, fonts included.

## Alternatives

- **Copying [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) in.** Rejected: a page has one service worker per scope, and the later step to installing as a PWA will extend this same worker. Its technique is written as part of our own worker instead.
- **A host that can send headers.** Not recorded why GitHub Pages was preferred at the time. [`public/_headers`](../../public/_headers) is kept for hosts that read it, and the decision to serve the app from the sync server later removes the problem.

## Consequences

- **A first visit, or a browser with service workers blocked, isn't isolated.** The app starts at once anyway, at the limited storage level, and moves up after the reload ([Progressive enhancement](../spec/persistence.md#progressive-enhancement)).
- **The project path matters:** Vite's `base` is `/week-budget-planner/`, and every URL the page loads is absolute from it, so it resolves on every path.
- **A deep path is served with status 404**, which browsers render all the same.
- **`require-corp` rules out cross-origin files** without CORS or CORP, so nothing is loaded from a CDN.
- **The headers are set three times**: in [`vite.config.ts`](../../vite.config.ts) for dev and preview, in `_headers`, and in the service worker. When the server serves the app, it sends them, and the limited level caused by a missing worker goes away.
