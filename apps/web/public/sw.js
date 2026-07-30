const VERSION = "hlovet-pwa-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith("http")) return;

  // Keep the app fully network-driven. This pass-through fetch handler gives
  // Chromium an installable service-worker lifecycle without caching auth,
  // uploads, or realtime data.
  event.respondWith(fetch(request));
});
