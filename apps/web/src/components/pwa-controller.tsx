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

const PUSH_IDENTITY_MESSAGE = "SET_ACTIVE_PUSH_USER";

export function PwaController() {
  useEffect(() => {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!("serviceWorker" in navigator) || (window.location.protocol !== "https:" && !isLocalhost)) return;

    let isMounted = true;
    let registration: ServiceWorkerRegistration | null = null;

    const syncIdentity = async () => {
      if (!isMounted) return;
      const activeRegistration = registration ?? await navigator.serviceWorker.ready;
      const userId = readAccessTokenUserId();
      activeRegistration.active?.postMessage({ type: PUSH_IDENTITY_MESSAGE, userId });

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
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  return null;
}
