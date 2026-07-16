"use client";

import { useEffect } from "react";
import { refreshStoredSession } from "@/lib/auth-api";
import {
  ACCESS_TOKEN_KEY,
  AUTH_STATE_CHANGE_EVENT,
  REFRESH_TOKEN_KEY,
  readAccessTokenExpiresAt,
  readRefreshToken,
} from "@/lib/auth-storage";

const REFRESH_EARLY_MS = 2 * 60 * 1000;
const RETRY_AFTER_NETWORK_ERROR_MS = 60 * 1000;
const MIN_RENEW_SCHEDULE_MS = 5 * 1000;

export function AuthSessionController() {
  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;

    function clearTimer() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function schedule(delayOverride?: number, minimumDelay = 0) {
      clearTimer();
      if (stopped || !readRefreshToken()) {
        return;
      }
      const expiresAt = readAccessTokenExpiresAt();
      const delay =
        delayOverride ??
        Math.max(0, (expiresAt ?? Date.now()) - Date.now() - REFRESH_EARLY_MS);
      timer = window.setTimeout(
        () => void renew(),
        Math.max(minimumDelay, delay),
      );
    }

    async function renew() {
      try {
        await refreshStoredSession();
        schedule(undefined, MIN_RENEW_SCHEDULE_MS);
      } catch {
        if (!readRefreshToken()) {
          if (!['/', '/login', '/register'].includes(window.location.pathname)) {
            window.location.replace('/');
          }
          return;
        }
        schedule(RETRY_AFTER_NETWORK_ERROR_MS);
      }
    }

    function handleStorage(event: StorageEvent) {
      if (
        event.key === ACCESS_TOKEN_KEY ||
        event.key === REFRESH_TOKEN_KEY ||
        event.key === null
      ) {
        schedule();
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        schedule();
      }
    }

    function handleAuthChange() {
      schedule();
    }

    function handleFocus() {
      schedule();
    }

    schedule();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, handleAuthChange);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      clearTimer();
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, handleAuthChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
