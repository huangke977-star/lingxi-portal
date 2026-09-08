"use client";

import Link from "next/link";
import { Database, Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { OfflineRemoveButton } from "@/components/offline-save-button";
import { useConfirm } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";
import {
  clearOfflineCache,
  getOfflineCacheInfo,
  OFFLINE_CACHE_CHANGE_EVENT,
  type OfflineCacheInfo,
  type OfflineEntryKind,
} from "@/lib/offline-cache";

const emptyInfo: OfflineCacheInfo = { entries: [], usedBytes: 0, maxBytes: 25 * 1024 * 1024, quotaBytes: null };

export default function OfflinePage() {
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [info, setInfo] = useState(emptyInfo);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => void getOfflineCacheInfo().then((next) => { if (active) setInfo(next); }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : phrase("无法读取离线缓存。", "Could not read offline storage.")); });
    load();
    window.addEventListener(OFFLINE_CACHE_CHANGE_EVENT, load);
    return () => { active = false; window.removeEventListener(OFFLINE_CACHE_CHANGE_EVENT, load); };
  }, [phrase]);

  async function clearAll() {
    if (!info.entries.length || !(await confirm(phrase("确定清空全部离线内容吗？", "Clear all offline content?")))) return;
    await clearOfflineCache().catch((clearError) => setError(clearError instanceof Error ? clearError.message : phrase("清空离线缓存失败。", "Could not clear offline storage.")));
  }

  const kindLabel = (kind: OfflineEntryKind) => kind === "article" ? phrase("文章", "Article") : kind === "topic" ? phrase("专题", "Topic") : phrase("合集", "Collection");
  const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  return <section className="page-shell offline-content-page">
    <ArticleCenterNav active="offline" isLoggedIn user={null} />
    <header className="offline-page-header"><div><span className="section-label"><Download aria-hidden="true" size={15} />{phrase("离线阅读", "Offline reading")}</span><h1>{phrase("已保存的内容", "Saved content")}</h1><p>{phrase("保存过的文章、专题和合集可以在网络不稳定时继续查看。", "Saved articles, topics, and collections remain available when the network is unreliable.")}</p></div><button className="button secondary" disabled={!info.entries.length} onClick={() => void clearAll()} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("清空全部", "Clear all")}</button></header>
    <div className="offline-storage-summary"><span><Database aria-hidden="true" size={16} /><strong>{info.entries.length}</strong><small>{phrase("项内容", "items")}</small></span><span><strong>{formatSize(info.usedBytes)}</strong><small>{phrase("已使用", "used")}</small></span><span><strong>{formatSize(info.maxBytes)}</strong><small>{phrase("上限", "limit")}</small></span></div>
    {info.entries.length ? <div className="offline-entry-list">{info.entries.map((entry) => <article className={entry.stale ? "stale" : ""} key={`${entry.kind}:${entry.id}`}><div className="offline-entry-icon"><Download aria-hidden="true" size={16} /></div><div className="offline-entry-main"><Link href={localizedPath(entry.route, locale)}><strong>{entry.title}</strong></Link><span>{kindLabel(entry.kind)} · {formatDate(entry.cachedAt)} · {formatSize(entry.sizeBytes)}</span>{entry.stale ? <small>{phrase("在线内容已更新，下次联网打开时会刷新缓存。", "The online content changed; it will refresh the next time you open it online.")}</small> : null}</div><OfflineRemoveButton id={entry.id} kind={entry.kind} title={entry.title} /></article>)}</div> : <div className="article-empty-state"><Download aria-hidden="true" size={24} /><strong>{phrase("还没有离线内容", "No offline content yet")}</strong><span>{phrase("在文章、专题或合集页面点击“保存离线”即可添加。", "Use “Save offline” on an article, topic, or collection page to add it here.")}</span></div>}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}
