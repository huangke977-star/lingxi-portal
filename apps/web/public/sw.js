const VERSION = "hlovet-pwa-v1";

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

self.addEventListener("fetch", () => {
  // Keep the app fully network-driven. This service worker only enables the
  // installable app lifecycle and does not cache authenticated or realtime data.
});
