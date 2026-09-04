"use client";

import Link from "next/link";
import { CheckCircle2, Coins, History, Hourglass, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { formatArticleDate } from "@/components/article-ui";
import { useLanguage } from "@/components/language-provider";
import { getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getCreatorResourceEarnings, type CreatorResourceEarnings } from "@/lib/resource-api";
import { localizedPath } from "@/lib/i18n";

const emptyEarnings: CreatorResourceEarnings = { summary: { total: 0, pending: 0, settled: 0, refunded: 0 }, aggregates: [], items: [] };

export default function ResourceEarningsPage() {
  const { locale, phrase } = useLanguage();
  const [earnings, setEarnings] = useState<CreatorResourceEarnings>(emptyEarnings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const token = readAccessToken();
      if (!token) {
        window.location.href = `${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/articles/resources/earnings", locale))}`;
        return;
      }
      Promise.all([getMe(token), getCreatorResourceEarnings(token)])
        .then(([, result]) => setEarnings(result))
        .catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("无法读取收益记录。", "Could not load earnings.")))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [locale, phrase]);

  const summaryItems = [
    { icon: Coins, label: phrase("累计兑换积分", "Gross points"), value: earnings.summary.total },
    { icon: Hourglass, label: phrase("待入账", "Pending"), value: earnings.summary.pending },
    { icon: CheckCircle2, label: phrase("已到账", "Settled"), value: earnings.summary.settled },
    { icon: RotateCcw, label: phrase("已退款", "Refunded"), value: earnings.summary.refunded },
  ];

  return <section className="page-shell articles-page resource-earnings-page">
    <ArticleCenterNav active="resources" isLoggedIn />
    <header className="profile-subpage-heading"><div><h1 className="resource-page-title"><History aria-hidden="true" size={17} />{phrase("资源收益", "Resource earnings")}</h1><p>{phrase("查看文章资源按区块汇总的待入账、到账和退款状态。", "Review pending, settled, and refunded earnings by article resource block.")}</p></div></header>
    {loading ? <div className="article-empty-state">{phrase("正在读取收益记录。", "Loading earnings.")}</div> : <>
      <div className="resource-earnings-summary">{summaryItems.map(({ icon: Icon, label, value }) => <div key={label}><Icon aria-hidden="true" size={16} /><span><small>{label}</small><strong>{value.toLocaleString(locale)}</strong></span></div>)}</div>
      <section className="resource-earnings-panel"><header><strong>{phrase("按文章与资源区块汇总", "By article and resource block")}</strong><small>{earnings.aggregates.length}</small></header>{earnings.aggregates.length ? <div className="resource-earnings-aggregate-list">{earnings.aggregates.map((item) => <Link href={localizedPath(`/articles/${item.article.slug}`, locale)} key={`${item.articleId}:${item.blockKey}`}><span><strong>{item.article.title}</strong><small>{phrase(`资源区块 · ${item.blockKey}`, `Resource block · ${item.blockKey}`)} · {item.redemptionCount} {phrase("次兑换", "redemptions")}</small></span><span><b><Coins aria-hidden="true" size={13} />{item.grossPoints}</b><small>{phrase(`待 ${item.pendingPoints} · 已到账 ${item.settledPoints} · 已退款 ${item.refundedPoints}`, `Pending ${item.pendingPoints} · Settled ${item.settledPoints} · Refunded ${item.refundedPoints}`)}</small></span></Link>)}</div> : <div className="article-empty-state">{phrase("暂无资源收益。", "No resource earnings yet.")}</div>}</section>
      <section className="resource-earnings-panel"><header><strong>{phrase("最近兑换明细", "Recent redemptions")}</strong><small>{earnings.items.length}</small></header>{earnings.items.length ? <div className="resource-earnings-recent-list">{earnings.items.map((item) => <article key={item.id}><span><strong>{item.article.title}</strong><small>{item.buyer.nickname} · {formatArticleDate(item.createdAt, locale)}</small></span><span><b><Coins aria-hidden="true" size={13} />{item.pointCost}</b><small>{item.status === "refunded" ? phrase("已退款", "Refunded") : item.settledAt ? phrase(`已于 ${formatArticleDate(item.settledAt, locale)}到账`, `Settled ${formatArticleDate(item.settledAt, locale)}`) : phrase(`预计 ${formatArticleDate(item.availableAt, locale)}到账`, `Expected ${formatArticleDate(item.availableAt, locale)}`)}</small></span></article>)}</div> : <div className="article-empty-state">{phrase("暂无兑换明细。", "No redemption details yet.")}</div>}</section>
    </>}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}
