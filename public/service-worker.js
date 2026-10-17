// Cross-origin isolation for hosts that can't send headers (GitHub Pages).
//
// The SQLite database needs SharedArrayBuffer, which needs the page to be cross-origin isolated.
// This worker adds the two headers to every response it handles, the technique of
// https://github.com/gzuidhof/coi-serviceworker, written as part of the app's own worker so a later
// PWA step can extend it (a scope has only one service worker). index.html registers it and reloads
// once when it takes control.
//
// It also adds the security headers a <meta> policy can't set (see Security in docs/SPEC.md).

// TypeScript checks this file through tsconfig.worker.json. Its WebWorker types give `self` the type
// of any worker, so it's typed here as the service worker it is: a JSDoc cast, since this plain
// script can't redeclare `self`, and the one assertion in the file.
// oxlint-disable-next-line no-inline-comments -- a JSDoc cast is written inline, in the expression it casts.
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

worker.addEventListener("install", () => {
  void worker.skipWaiting();
});
worker.addEventListener("activate", (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  // Chrome throws for this combination when the request is forwarded.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  event.respondWith(
    (async () => {
      const response = await fetch(request);
      // Opaque responses can't be read or changed; with require-corp they won't load anyway.
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      if (request.mode === "navigate") {
        // The <meta> policy in index.html covers the rest; frame-ancestors only works as a header.
        headers.set("Content-Security-Policy", "frame-ancestors 'none'");
        headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      }
      if (new URL(request.url).origin === worker.location.origin) {
        headers.set("Cross-Origin-Resource-Policy", "same-origin");
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
