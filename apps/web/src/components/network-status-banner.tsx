"use client";

import { CloudOff, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { getBrowserApiBaseUrl } from "@/lib/auth-api";

export function NetworkStatusBanner() {
  const { t } = useLanguage();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
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
    // The first client render can inherit a stale SSR/hydration value. Read
    // the live browser state once after mounting before waiting for events.
    if (navigator.onLine) setOnline(true);
    // navigator.onLine can remain false in a browser profile that has a working
    // connection. A small health probe corrects that initial state without
    // turning a temporarily unavailable API into a false offline banner.
    if (navigator.onLine === false) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2500);
      void fetch(`${getBrowserApiBaseUrl()}/health`, { cache: "no-store", credentials: "omit", signal: controller.signal })
        .then((response) => {
          if (active && response.ok) setOnline(true);
        })
        .catch(() => undefined)
        .finally(() => window.clearTimeout(timeout));
    }
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
