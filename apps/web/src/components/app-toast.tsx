"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type AppToastTone = "success" | "error" | "info";

interface AppToastProps {
  message: string;
  tone?: AppToastTone;
  duration?: number;
  persistent?: boolean;
  onDismiss?: () => void;
}

export function AppToast({
  message,
  tone = "success",
  duration = 2600,
  persistent = false,
  onDismiss,
}: AppToastProps) {
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message || persistent || !dismissRef.current) {
      return;
    }

    const timer = window.setTimeout(() => dismissRef.current?.(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, persistent]);

  if (!message || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <p
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`app-toast ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {message}
    </p>,
    document.body,
  );
}
