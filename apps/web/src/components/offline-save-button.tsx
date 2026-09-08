"use client";

import { Check, Download, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import {
  getOfflineEntry,
  OFFLINE_CACHE_CHANGE_EVENT,
  removeOfflineEntry,
  saveOfflineEntry,
  type OfflineEntryData,
  type OfflineEntryKind,
} from "@/lib/offline-cache";

export function OfflineSaveButton<T extends OfflineEntryData>({
  data,
  id,
  kind,
  route,
  title,
  updatedAt,
  mediaUrls,
}: {
  data: T;
  id: string;
  kind: OfflineEntryKind;
  route: string;
  title: string;
  updatedAt: string;
  mediaUrls?: string[];
}) {
  const { phrase } = useLanguage();
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getOfflineEntry(kind, id).then((entry) => { if (active) setCached(Boolean(entry)); });
    const refresh = () => void getOfflineEntry(kind, id).then((entry) => { if (active) setCached(Boolean(entry)); });
    window.addEventListener(OFFLINE_CACHE_CHANGE_EVENT, refresh);
    return () => { active = false; window.removeEventListener(OFFLINE_CACHE_CHANGE_EVENT, refresh); };
  }, [id, kind]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (cached) {
        await removeOfflineEntry(kind, id);
      } else {
        await saveOfflineEntry({ kind, id, title, route, updatedAt, data, mediaUrls });
      }
      setCached(!cached);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("离线缓存操作失败。", "Could not update offline storage."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button aria-pressed={cached} className={`offline-save-button${cached ? " active" : ""}`} disabled={busy} onClick={() => void toggle()} title={cached ? phrase("移除离线缓存", "Remove offline copy") : phrase("保存离线阅读", "Save for offline reading")} type="button">
      {busy ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : cached ? <Check aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}
      {cached ? phrase("已保存离线", "Saved offline") : phrase("保存离线", "Save offline")}
    </button>
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </>;
}

export function OfflineRemoveButton({ kind, id, title }: { kind: OfflineEntryKind; id: string; title: string }) {
  const { phrase } = useLanguage();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (busy) return;
    setBusy(true);
    await removeOfflineEntry(kind, id).catch(() => undefined);
    setBusy(false);
  }
  return <button aria-label={phrase(`移除离线缓存 ${title}`, `Remove offline copy of ${title}`)} className="offline-remove-button" disabled={busy} onClick={() => void remove()} title={phrase("移除离线缓存", "Remove offline copy")} type="button"><Trash2 aria-hidden="true" size={15} /></button>;
}
