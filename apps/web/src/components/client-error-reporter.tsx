"use client";

import { useEffect } from "react";
import { getBrowserApiBaseUrl } from "@/lib/auth-api";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "web";
const DEDUPE_WINDOW_MS = 30_000;

export function ClientErrorReporter() {
  useEffect(() => {
    const recentlyReported = new Map<string, number>();

    function report(source: "window-error" | "unhandled-rejection" | "manual", error: unknown): void {
      const normalized = normalizeError(error);
      if (!normalized.message) return;
      const key = `${source}:${normalized.message}:${window.location.pathname}`;
      const previous = recentlyReported.get(key) ?? 0;
      if (Date.now() - previous < DEDUPE_WINDOW_MS) return;
      recentlyReported.set(key, Date.now());
      if (recentlyReported.size > 40) {
        const cutoff = Date.now() - DEDUPE_WINDOW_MS;
        for (const [entry, timestamp] of recentlyReported) if (timestamp < cutoff) recentlyReported.delete(entry);
      }

      const payload = JSON.stringify({
        source,
        message: normalized.message,
        path: `${window.location.pathname}${window.location.search}`,
        stack: normalized.stack,
        buildId: BUILD_ID,
      });
      const url = `${getBrowserApiBaseUrl()}/health/client-errors`;
      void fetch(url, {
        method: "POST",
        body: payload,
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
    }

    const handleError = (event: ErrorEvent) => report("window-error", event.error ?? event.message);
    const handleRejection = (event: PromiseRejectionEvent) => report("unhandled-rejection", event.reason);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: error.message.slice(0, 500), stack: error.stack?.slice(0, 2_000) ?? null };
  if (typeof error === "string") return { message: error.slice(0, 500), stack: null };
  try {
    const serialized = JSON.stringify(error);
    return { message: (serialized === undefined ? String(error) : serialized).slice(0, 500), stack: null };
  } catch { return { message: "Unknown client error", stack: null }; }
}
