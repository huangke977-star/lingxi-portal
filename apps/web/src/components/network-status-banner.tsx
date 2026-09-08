"use client";

import { CloudOff, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";

export function NetworkStatusBanner() {
  const { phrase } = useLanguage();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    let recoveryTimer: number | null = null;
    const handleOffline = () => { setOnline(false); setShowRecovery(false); };
    const handleOnline = () => {
      setOnline(true);
      setShowRecovery(true);
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(() => setShowRecovery(false), 2600);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    };
  }, []);

  if (online && !showRecovery) return null;
  return <div aria-live="polite" className={`network-status-banner${online ? " recovered" : ""}`} role="status">
    {online ? <Wifi aria-hidden="true" size={15} /> : <CloudOff aria-hidden="true" size={15} />}
    <span>{online ? phrase("网络已恢复，正在继续同步。", "Connection restored. Sync is continuing.") : phrase("当前处于离线状态，已保存内容仍可查看。", "You are offline. Saved content is still available.")}</span>
  </div>;
}
