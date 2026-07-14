"use client";

import { useEffect } from "react";
import {
  applyThemePreference,
  readThemePreference,
  THEME_CHANGE_EVENT,
} from "@/lib/theme-preferences";
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
    void syncBackground();
    window.addEventListener("storage", syncTheme);
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener(BACKGROUND_CHANGE_EVENT, handleBackgroundChange);

    return () => {
      isMounted = false;
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener(BACKGROUND_CHANGE_EVENT, handleBackgroundChange);
    };
  }, []);

  return null;
}
