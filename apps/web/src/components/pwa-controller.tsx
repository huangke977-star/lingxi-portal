"use client";

import { useEffect } from "react";

export function PwaController() {
  useEffect(() => {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!("serviceWorker" in navigator) || (window.location.protocol !== "https:" && !isLocalhost)) return;

    let isMounted = true;
    const register = () => {
      if (!isMounted) return;
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      isMounted = false;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
