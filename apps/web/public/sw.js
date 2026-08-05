const VERSION = "hlovet-pwa-v4";
const PUSH_IDENTITY_CACHE = `${VERSION}-identity`;
const PUSH_IDENTITY_KEY = "/__hlovet_push_identity__";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "SET_ACTIVE_PUSH_USER") {
    event.waitUntil(writeActivePushUser(event.data.userId));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }
  event.waitUntil((async () => {
    const recipientUserId = normalizeUserId(payload.recipientUserId);
    if (recipientUserId && recipientUserId !== await readActivePushUser()) return;

    const title = payload.title || "HLOVET";
    await self.registration.showNotification(title, {
      body: payload.body || "你有一条新消息。",
      icon: payload.icon || "/icon-192.png",
      badge: payload.badge || "/favicon-48x48.png",
      tag: payload.tag || "hlovet-notification",
      renotify: true,
      data: { url: payload.url || "/", recipientUserId },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    const recipientUserId = normalizeUserId(event.notification.data?.recipientUserId);
    if (recipientUserId && recipientUserId !== await readActivePushUser()) {
      return existing?.focus();
    }
    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith("http")) return;

  // Keep the app fully network-driven. This pass-through fetch handler gives
  // Chromium an installable service-worker lifecycle without caching auth,
  // uploads, or realtime data.
  event.respondWith(fetch(request));
});

async function writeActivePushUser(value) {
  const cache = await caches.open(PUSH_IDENTITY_CACHE);
  const userId = normalizeUserId(value);
  if (!userId) {
    await cache.delete(PUSH_IDENTITY_KEY);
    return;
  }
  await cache.put(PUSH_IDENTITY_KEY, new Response(String(userId), {
    headers: { "Content-Type": "text/plain" },
  }));
}

async function readActivePushUser() {
  const cache = await caches.open(PUSH_IDENTITY_CACHE);
  const response = await cache.match(PUSH_IDENTITY_KEY);
  return response ? normalizeUserId(await response.text()) : null;
}

function normalizeUserId(value) {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}
