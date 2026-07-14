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
  BACKGROUND_CHANGE_EVENT,
  getActiveBackground,
  resolveBackgroundUrl,
} from "@/lib/background-api";

export function ThemeController() {
  useEffect(() => {
    let isMounted = true;

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
        const background = await getActiveBackground();
        if (!isMounted) {
          return;
        }

        if (background) {
          document.documentElement.style.setProperty(
            "--portal-bg-image",
            `url("${resolveBackgroundUrl(background)}")`,
          );
        } else {
          document.documentElement.style.removeProperty("--portal-bg-image");
        }
      } catch {
        document.documentElement.style.removeProperty("--portal-bg-image");
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
