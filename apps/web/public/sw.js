const VERSION = "hlovet-pwa-v9";
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_ROUTE_CACHE = "hlovet-offline-routes-v1";
const PUSH_IDENTITY_CACHE = `${VERSION}-identity`;
const PUSH_DEDUP_CACHE = `${VERSION}-dedup`;
const PUSH_IDENTITY_KEY = "/__hlovet_push_identity__";
const PWA_ICON_KEY = "/__hlovet_pwa_icon__";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(["/", "/offline"].map((path) => cache.add(path).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("hlovet-pwa-v") && !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "SET_ACTIVE_PUSH_USER") {
    event.waitUntil(writeActivePushUser(event.data.userId));
    return;
  }
  if (event.data?.type === "SET_PWA_ICON") {
    event.waitUntil(writePwaIcon(event.data.icon));
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

    const locale = payload.locale === "en-US" ? "en-US" : "zh-CN";
    const title = locale === "en-US" ? (payload.titleEn || payload.title || "HLOVET") : (payload.title || "HLOVET");
    const body = locale === "en-US" ? (payload.bodyEn || payload.body || "You have a new notification.") : (payload.body || "你有一条新消息。");
    const tag = payload.tag || "hlovet-notification";
    const dedupeKey = payload.dedupeKey || (tag.startsWith("notification-") ? tag : "");
    if (dedupeKey && await isDuplicatePush(dedupeKey)) return;
    const fallbackIcon = await readPwaIcon();
    await self.registration.showNotification(title, {
      body,
      icon: payload.icon || fallbackIcon,
      badge: payload.badge || "/favicon-48x48.png",
      tag,
      renotify: !tag.startsWith("notification-"),
      data: { url: payload.url || "/", recipientUserId, category: payload.category || "system" },
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isExcludedPath(url.pathname)) return;
  event.respondWith(networkFirst(request));
});

function isExcludedPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/socket.io/") || pathname.startsWith("/uploads/") || pathname.startsWith("/media/");
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && (request.mode === "navigate" || response.type === "basic")) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const routeCache = await caches.open(OFFLINE_ROUTE_CACHE);
    const cached = await cache.match(request) || await routeCache.match(request.url);
    if (cached) return cached;
    if (request.mode === "navigate") return (await cache.match("/")) || Response.error();
    throw new Error("Offline resource unavailable");
  }
}

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

async function writePwaIcon(value) {
  const icon = typeof value === "string" && value.trim() ? value.trim() : "/pwa-logo.png";
  const cache = await caches.open(PUSH_IDENTITY_CACHE);
  await cache.put(PWA_ICON_KEY, new Response(icon, { headers: { "Content-Type": "text/plain" } }));
}

async function readPwaIcon() {
  const cache = await caches.open(PUSH_IDENTITY_CACHE);
  const response = await cache.match(PWA_ICON_KEY);
  return response ? await response.text() : "/pwa-logo.png";
}

async function isDuplicatePush(tag) {
  const cache = await caches.open(PUSH_DEDUP_CACHE);
  const key = `/__hlovet_push_dedup__/${encodeURIComponent(tag)}`;
  const existing = await cache.match(key);
  if (existing) {
    const timestamp = Number(await existing.text());
    if (Number.isFinite(timestamp) && Date.now() - timestamp < 120_000) return true;
  }
  await cache.put(key, new Response(String(Date.now()), { headers: { "Content-Type": "text/plain" } }));
  return false;
}

function normalizeUserId(value) {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}
