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
  cacheDefaultBackgroundUrl,
  clearDefaultBackgroundCache,
  BACKGROUND_CHANGE_EVENT,
  readCachedDefaultBackgroundUrl,
} from "@/lib/background-api";
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";

export function ThemeController() {
  useEffect(() => {
    let isMounted = true;
    let publicSettings: SiteSettings | null = null;

    function applyBackgroundUrl(url: string) {
      document.documentElement.style.setProperty("--portal-bg-image", `url("${escapeCssUrl(url)}")`);
      cacheDefaultBackgroundUrl(url);
    }

    function preloadBackground(url: string): Promise<void> {
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
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
      try {
        const defaultBackgroundUrl = publicSettings?.defaultBackgroundUrl;
        if (defaultBackgroundUrl) {
          const nextUrl = resolveConfiguredAssetUrl(defaultBackgroundUrl);
          await preloadBackground(nextUrl);
          if (isMounted) applyBackgroundUrl(nextUrl);
        } else {
          clearDefaultBackgroundCache();
          document.documentElement.style.removeProperty("--portal-bg-image");
        }
      } catch {
        const cachedUrl = readCachedDefaultBackgroundUrl();
        if (cachedUrl) {
          applyBackgroundUrl(cachedUrl);
        }
      }
    }

    function handleBackgroundChange() {
      void syncPublicSettings().then(() => syncBackground());
    }

    syncTheme();
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
