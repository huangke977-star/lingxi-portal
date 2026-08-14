"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { PortalEntry, portalEntryMarker } from "@/lib/portal-api";

export function PortalEntryVisual({
  entry,
  className = "",
}: {
  entry: Pick<PortalEntry, "id" | "title" | "iconPath">;
  className?: string;
}) {
  const iconPath = entry.iconPath?.trim() || null;
  const [failedIconPath, setFailedIconPath] = useState<string | null>(null);
  const hasIcon = Boolean(iconPath && failedIconPath !== iconPath);

  return (
    <span
      aria-hidden="true"
      className={`p8-entry-icon${hasIcon ? " has-image" : ""}${className ? ` ${className}` : ""}`}
    >
      {hasIcon ? (
        <img alt="" onError={() => setFailedIconPath(iconPath)} src={iconPath ?? ""} />
      ) : (
        portalEntryMarker(entry.title)
      )}
    </span>
  );
}
