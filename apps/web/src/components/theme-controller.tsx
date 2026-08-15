"use client";

import { useEffect } from "react";
import {
  applyThemePreference,
  readThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from "@/lib/theme-preferences";
import { getMe, resolveApiUrl } from "@/lib/auth-api";
import { AUTH_STATE_CHANGE_EVENT, readAccessToken } from "@/lib/auth-storage";
import {
  BACKGROUND_CHANGE_EVENT,
  clearBackgroundCaches,
  getActiveBackground,
  resolveBackgroundUrl,
} from "@/lib/background-api";
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";

export function ThemeController() {
  useEffect(() => {
    let isMounted = true;
    let publicSettings: SiteSettings | null = null;
    let backgroundSyncId = 0;

    function applyBackgroundUrl(url: string) {
      document.documentElement.style.setProperty("--portal-bg-image", `url("${escapeCssUrl(url)}")`);
    }

    function preloadBackground(url: string): Promise<boolean> {
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = url;
      });
    }

    function syncTheme() {
      applyThemePreference(readThemePreference());
    }

    async function syncPublicSettings() {
      try {
        const settings = await getPublicSiteSettings();
        if (!isMounted) {
          return;
        }
        publicSettings = settings;
        document.title = settings.browserTitle || settings.siteName || "HLOVET";
        if (!readAccessToken() && !window.localStorage.getItem(THEME_STORAGE_KEY)) {
          applyThemePreference(settings.defaultTheme);
        }
      } catch {
        publicSettings = null;
      }
    }

    async function syncAccountTheme() {
      const accessToken = readAccessToken();
      if (!accessToken) {
        syncTheme();
        return;
      }

      try {
        const user = await getMe(accessToken);
        if (!isMounted) {
          return;
        }

        writeThemePreference(user.appearance);
      } catch {
        syncTheme();
      }
    }

    async function syncBackground() {
      const syncId = ++backgroundSyncId;
      try {
        const activeBackground = await getActiveBackground();
        if (!isMounted || syncId !== backgroundSyncId) return;
        const defaultBackgroundUrl = publicSettings?.defaultBackgroundUrl ?? "";
        const nextUrl = activeBackground
          ? resolveBackgroundUrl(activeBackground)
          : defaultBackgroundUrl
            ? resolveConfiguredAssetUrl(defaultBackgroundUrl)
            : "";
        if (!nextUrl) {
          document.documentElement.style.removeProperty("--portal-bg-image");
          return;
        }

        const isAvailable = await preloadBackground(nextUrl);
        if (!isMounted || syncId !== backgroundSyncId) return;
        if (isAvailable) applyBackgroundUrl(nextUrl);
        else document.documentElement.style.removeProperty("--portal-bg-image");
      } catch {
        if (isMounted && syncId === backgroundSyncId) document.documentElement.style.removeProperty("--portal-bg-image");
      }
    }

    function handleBackgroundChange() {
      void syncPublicSettings().then(() => syncBackground());
    }

    syncTheme();
    clearBackgroundCaches();
    void syncPublicSettings().then(() => syncBackground());
    void syncAccountTheme();
    window.addEventListener("storage", syncTheme);
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, syncAccountTheme);
    window.addEventListener(BACKGROUND_CHANGE_EVENT, handleBackgroundChange);

    return () => {
      isMounted = false;
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, syncAccountTheme);
      window.removeEventListener(BACKGROUND_CHANGE_EVENT, handleBackgroundChange);
    };
  }, []);

  return null;
}

function escapeCssUrl(url: string): string {
  return url.replace(/["\\\n\r\f]/g, "\\$&");
}

function resolveConfiguredAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/api/")) {
    return resolveApiUrl(path.slice(4));
  }
  return new URL(path.startsWith("/") ? path : `/${path}`, window.location.origin).href;
}
