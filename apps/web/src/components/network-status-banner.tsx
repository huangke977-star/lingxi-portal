"use client";

import { CloudOff, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { getBrowserApiBaseUrl } from "@/lib/auth-api";

export function NetworkStatusBanner() {
  const { t } = useLanguage();
  // Start optimistically online. Some browser profiles report a transient
  // false value during hydration and do not emit the matching online event.
  const [online, setOnline] = useState(true);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    let recoveryTimer: number | null = null;
    let active = true;
    const handleOffline = () => { setOnline(false); setShowRecovery(false); };
    const handleOnline = () => {
      setOnline(true);
      setShowRecovery(true);
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(() => setShowRecovery(false), 2600);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    // navigator.onLine can remain false in a browser profile that has a working
    // connection. A small health probe corrects that initial state without
    // turning a temporarily unavailable API into a false offline banner.
    const probe = async () => {
      const probeUrls = Array.from(new Set(["/api/health", `${getBrowserApiBaseUrl()}/health`]));
      for (const url of probeUrls) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 2500);
        try {
          const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: controller.signal });
          if (active && response.ok) {
            setOnline(true);
            return;
          }
        } catch {
          // Try the configured API origin after the same-origin route fails.
        } finally {
          window.clearTimeout(timeout);
        }
      }
      if (active && navigator.onLine === false) setOnline(false);
    };
    void probe();
    return () => {
      active = false;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    };
  }, []);

  if (online && !showRecovery) return null;
  return <div aria-live="polite" className={`network-status-banner${online ? " recovered" : ""}`} role="status">
    {online ? <Wifi aria-hidden="true" size={15} /> : <CloudOff aria-hidden="true" size={15} />}
    <span>{online ? t("network.recoveredStatus") : t("network.offlineStatus")}</span>
  </div>;
}
