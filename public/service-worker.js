// Cross-origin isolation for hosts that can't send headers (GitHub Pages).
//
// The SQLite database needs SharedArrayBuffer, which needs the page to be cross-origin isolated.
// This worker adds the two headers to every response it handles, the technique of
// https://github.com/gzuidhof/coi-serviceworker, written as part of the app's own worker so a later
// PWA step can extend it (a scope has only one service worker). index.html registers it and reloads
// once when it takes control.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
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
      if (new URL(request.url).origin === self.location.origin) {
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
