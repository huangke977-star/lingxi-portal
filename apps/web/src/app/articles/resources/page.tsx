"use client";

import { Coins, Download, ShoppingBag, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { getMe, type AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getResourceCatalogSummary, listResourceCatalog, type ResourceCatalog } from "@/lib/discovery-api";
import { formatArticleDate } from "@/components/article-ui";
import { localizedPath } from "@/lib/i18n";

type ResourceSort = "latest" | "popular" | "price";
const emptyCatalog: ResourceCatalog = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function ResourceCenterPage() {
  const { locale, phrase } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [catalog, setCatalog] = useState<ResourceCatalog>(emptyCatalog);
  const [summary, setSummary] = useState({ purchasedBlocks: 0, soldBlocks: 0, pendingPoints: 0 });
  const [sort, setSort] = useState<ResourceSort>("latest");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const token = readAccessToken();
      setIsLoading(true);
      Promise.all([
        listResourceCatalog(token, { q: query, sort, pageSize: 24 }),
        token ? getMe(token).catch(() => null) : Promise.resolve(null),
        token ? getResourceCatalogSummary(token).catch(() => null) : Promise.resolve(null),
      ]).then(([nextCatalog, nextUser, nextSummary]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setUser(nextUser);
        if (nextSummary) setSummary(nextSummary);
        setError("");
      }).catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : phrase("资源中心加载失败。", "Could not load resources."));
      }).finally(() => { if (active) setIsLoading(false); });
    }, query ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [phrase, query, sort]);

  const sortOptions: ReadonlyArray<{ label: string; value: ResourceSort }> = [
    { label: phrase("最新发布", "Latest"), value: "latest" },
    { label: phrase("综合热度", "Popular"), value: "popular" },
    { label: phrase("所需积分", "Lowest price"), value: "price" },
  ];

  return <section className="page-shell articles-page resource-center-page">
    <ArticleCenterNav active="resources" isLoggedIn={Boolean(user)} user={user} />
    <div className="resource-catalog-toolbar">
      {user ? <div className="resource-catalog-summary">
        <span><Download aria-hidden="true" size={15} /><small>{phrase("已兑换", "Unlocked")}</small><b>{summary.purchasedBlocks}</b></span>
        <span><ShoppingBag aria-hidden="true" size={15} /><small>{phrase("已售区域", "Sold sections")}</small><b>{summary.soldBlocks}</b></span>
        <span><Coins aria-hidden="true" size={15} /><small>{phrase("待入账积分", "Pending points")}</small><b>{summary.pendingPoints}</b></span>
      </div> : null}
      <label><Sparkles aria-hidden="true" size={16} /><input aria-label={phrase("搜索积分资源", "Search point resources")} onChange={(event) => setQuery(event.target.value)} placeholder={phrase("搜索资源、作者或分类", "Search resources, authors, or categories")} value={query} /></label>
      <span className="resource-catalog-toolbar-actions"><GlassSelect ariaLabel={phrase("资源排序", "Resource sort")} onChange={setSort} options={sortOptions} value={sort} /><Link className="text-action" href={localizedPath("/articles/resources/orders", locale)}>{phrase("兑换记录", "Deliveries")}</Link></span>
    </div>
    {isLoading ? <div className="article-empty-state">{phrase("正在读取积分资源。", "Loading point resources.")}</div> : catalog.items.length ? <div className="resource-catalog-list">
      {catalog.items.map((item) => <Link href={localizedPath(`/articles/${item.article.slug}`, locale)} key={item.article.id}>
        <span><strong>{item.article.title}</strong><small>{item.article.author.nickname} · {item.article.category || phrase("未分类", "Uncategorized")} · {formatArticleDate(item.article.publishedAt, locale)}</small></span>
        <span className="resource-catalog-row-stats"><em><Coins aria-hidden="true" size={14} />{item.minimumPointCost}</em><small>{phrase(`${item.blockCount} 个区域 · ${item.exchangeCount} 次兑换`, `${item.blockCount} sections · ${item.exchangeCount} unlocks`)}</small></span>
      </Link>)}
    </div> : <div className="article-empty-state"><strong>{phrase("暂无积分资源", "No point resources yet")}</strong><span>{phrase("带有资源区域的已发布文章会出现在这里。", "Published articles with protected resource sections appear here.")}</span></div>}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}
