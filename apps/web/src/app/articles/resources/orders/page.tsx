"use client";

import Link from "next/link";
import { Download, History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { downloadResourceDelivery, listMyResourceDeliveries, retryResourceDelivery, type ResourceDelivery, type ResourceDeliveryStatus } from "@/lib/discovery-api";
import { localizedPath } from "@/lib/i18n";

export default function ResourceOrdersPage() {
  const { locale, phrase } = useLanguage();
  const [items, setItems] = useState<ResourceDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const token = readAccessToken();
    if (!token) { window.location.href = `${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/articles/resources/orders", locale))}`; return; }
    try { await getMe(token); setItems((await listMyResourceDeliveries(token)).items); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取兑换记录。", "Could not load resource deliveries.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  async function action(item: ResourceDelivery, kind: "download" | "retry") {
    const token = readAccessToken(); if (!token) return;
    try { if (kind === "download") await downloadResourceDelivery(token, item.id); else await retryResourceDelivery(token, item.id); await load(); setNotice(kind === "download" ? phrase("已记录下载。", "Download recorded.") : phrase("已重新尝试交付。", "Delivery retry started.")); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : phrase("操作失败。", "Action failed.")); }
  }

  const statusLabel = (status: ResourceDeliveryStatus) => status === "downloaded" ? phrase("已下载", "Downloaded") : status === "failed" ? phrase("交付失败", "Failed") : status === "refunded" ? phrase("已退款", "Refunded") : phrase("已解锁", "Unlocked");
  return <section className="page-shell articles-page resource-orders-page"><ArticleCenterNav active="resources" isLoggedIn /><header className="profile-subpage-heading"><div><span className="section-label"><History aria-hidden="true" size={14} /> RESOURCE DELIVERY</span><h1>{phrase("兑换记录", "Resource deliveries")}</h1><p>{phrase("查看兑换、下载、失败和退款状态。", "Review redemption, download, failure, and refund status.")}</p></div><Link className="text-action" href={localizedPath("/articles/resources", locale)}>{phrase("返回资源中心", "Back to resources")}</Link></header>{loading ? <div className="article-empty-state">{phrase("正在读取兑换记录。", "Loading resource deliveries.")}</div> : items.length ? <div className="resource-delivery-list">{items.map((item) => <article key={item.id}><div className="resource-delivery-main"><strong>{item.article.title}</strong><small>{phrase(`资源区块 · ${item.pointCost} 积分`, `Resource block · ${item.pointCost} points`)} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small><span className={`resource-delivery-status ${item.status}`}>{statusLabel(item.status)}{item.lastError ? ` · ${item.lastError}` : ""}</span></div><div className="resource-delivery-actions">{item.status === "unlocked" || item.status === "downloaded" ? <button className="text-action" onClick={() => void action(item, "download")} type="button"><Download aria-hidden="true" size={15} />{phrase("下载", "Download")}</button> : null}{item.status === "failed" ? <button className="text-action" onClick={() => void action(item, "retry")} type="button"><RotateCcw aria-hidden="true" size={15} />{phrase("重试", "Retry")}</button> : null}</div><details><summary>{phrase(`交付记录（${item.events.length}）`, `Delivery history (${item.events.length})`)}</summary><div>{item.events.map((event) => <small key={event.id}>{event.type} · {event.detail || "-"} · {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</small>)}</div></details></article>)}</div> : <div className="article-empty-state"><strong>{phrase("暂无兑换记录", "No resource deliveries")}</strong><span>{phrase("兑换积分资源后，记录会显示在这里。", "Your resource redemption records will appear here.")}</span></div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
