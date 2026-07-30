"use client";

import { useEffect } from "react";
import {
  applyThemePreference,
  readThemePreference,
  THEME_CHANGE_EVENT,
  writeThemePreference,
} from "@/lib/theme-preferences";
import { getMe } from "@/lib/auth-api";
import { AUTH_STATE_CHANGE_EVENT, readAccessToken } from "@/lib/auth-storage";
import {
  cacheActiveBackgroundUrl,
  clearActiveBackgroundCache,
  BACKGROUND_CHANGE_EVENT,
  getActiveBackground,
  readCachedActiveBackgroundUrl,
  resolveBackgroundUrl,
} from "@/lib/background-api";

export function ThemeController() {
  useEffect(() => {
    let isMounted = true;

    function applyBackgroundUrl(url: string) {
      document.documentElement.style.setProperty("--portal-bg-image", `url("${escapeCssUrl(url)}")`);
      cacheActiveBackgroundUrl(url);
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
        const cachedUrl = readCachedActiveBackgroundUrl();
        if (cachedUrl) {
          applyBackgroundUrl(cachedUrl);
        }

        const background = await getActiveBackground();
        if (!isMounted) {
          return;
        }

        if (background) {
          const nextUrl = resolveBackgroundUrl(background);
          cacheActiveBackgroundUrl(nextUrl);
          await preloadBackground(nextUrl);
          if (isMounted) {
            applyBackgroundUrl(nextUrl);
          }
        } else {
          clearActiveBackgroundCache();
          document.documentElement.style.removeProperty("--portal-bg-image");
        }
      } catch {
        const cachedUrl = readCachedActiveBackgroundUrl();
        if (cachedUrl) {
          applyBackgroundUrl(cachedUrl);
        }
      }
    }

    function handleBackgroundChange() {
      void syncBackground();
    }

    syncTheme();
    void syncAccountTheme();
    void syncBackground();
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
