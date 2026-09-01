"use client";

import { useEffect } from "react";
import {
  ACCESS_TOKEN_KEY,
  AUTH_STATE_CHANGE_EVENT,
  REFRESH_TOKEN_KEY,
  readAccessToken,
  readAccessTokenUserId,
} from "@/lib/auth-storage";
import { syncBrowserPushOwner } from "@/lib/push-api";
import { getPublicSiteSettings } from "@/lib/site-settings-api";

const PUSH_IDENTITY_MESSAGE = "SET_ACTIVE_PUSH_USER";
const PWA_ICON_MESSAGE = "SET_PWA_ICON";

export function PwaController() {
  useEffect(() => {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const canUseServiceWorker = "serviceWorker" in navigator && (window.location.protocol === "https:" || isLocalhost);

    let isMounted = true;
    let registration: ServiceWorkerRegistration | null = null;
    let currentIconPath = "/pwa-logo.png";

    const syncBrandIcons = async () => {
      const settings = await getPublicSiteSettings().catch(() => null);
      if (!isMounted || !settings) return;
      currentIconPath = versionedIconPath(normalizeConfiguredIconPath(settings.pwaIconPath || "/pwa-logo.png"), settings.updatedAt);
      syncHeadIcon("icon", currentIconPath);
      syncHeadIcon("shortcut icon", currentIconPath);
      if (settings.browserTitle) document.title = settings.browserTitle;
      registration?.active?.postMessage({ type: PWA_ICON_MESSAGE, icon: currentIconPath });
    };

    void syncBrandIcons();
    const handleVisibility = () => { if (document.visibilityState === "visible") void syncBrandIcons(); };
    window.addEventListener("focus", syncBrandIcons);
    document.addEventListener("visibilitychange", handleVisibility);

    if (!canUseServiceWorker) {
      return () => {
        isMounted = false;
        window.removeEventListener("focus", syncBrandIcons);
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    }

    const syncIdentity = async () => {
      if (!isMounted) return;
      const activeRegistration = registration ?? await navigator.serviceWorker.ready;
      const userId = readAccessTokenUserId();
      activeRegistration.active?.postMessage({ type: PUSH_IDENTITY_MESSAGE, userId });
      activeRegistration.active?.postMessage({ type: PWA_ICON_MESSAGE, icon: currentIconPath });

      const accessToken = readAccessToken();
      if (accessToken && userId) {
        await syncBrowserPushOwner(accessToken).catch(() => undefined);
      }
    };

    const register = async () => {
      if (!isMounted) return;
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await syncIdentity();
    };

    const handleAuthChange = () => void syncIdentity();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_KEY || event.key === REFRESH_TOKEN_KEY || event.key === null) {
        void syncIdentity();
      }
    };
    const handleControllerChange = () => void syncIdentity();

    if (document.readyState === "complete") {
      void register().catch(() => undefined);
    } else {
      window.addEventListener("load", register, { once: true });
    }
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, handleAuthChange);
    window.addEventListener("storage", handleStorage);
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      isMounted = false;
      window.removeEventListener("load", register);
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, handleAuthChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncBrandIcons);
      document.removeEventListener("visibilitychange", handleVisibility);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return null;
}

function versionedIconPath(path: string, updatedAt: string): string {
  if (!updatedAt) return path;
  return `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(updatedAt)}`;
}

function normalizeConfiguredIconPath(path: string): string {
  return path.startsWith("/site-settings/") ? `/api${path}` : path;
}

function syncHeadIcon(rel: "icon" | "shortcut icon" | "apple-touch-icon", href: string): void {
  const selector = `link[rel="${rel}"]`;
  const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>(selector));
  if (links.length) {
    links.forEach((link) => { link.href = href; });
    return;
  }
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}
