"use client";

/* eslint-disable @next/next/no-img-element */

import { Compass, ExternalLink, FileText, Search, UserRound, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { globalSearch, GlobalSearchResult, SearchCategoryFilter } from "@/lib/search-api";
import { getAvatarFallbackText } from "@/lib/user-display";

type SearchTab = "all" | "articles" | "users" | "navigation" | "tools";

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const activeTab = normalizeTab(searchParams.get("tab"));
  const category = searchParams.get("category") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  return <SearchResults activeTab={activeTab} category={category} key={`${query}-${activeTab}-${category}`} page={page} query={query} />;
}

function SearchResults({ activeTab, category, page, query }: { activeTab: SearchTab; category: string; page: number; query: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(query);
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(query));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError("");
      globalSearch(query, {
        accessToken: readAccessToken(),
        page: activeTab === "all" ? 1 : page,
        pageSize: activeTab === "all" ? 6 : 12,
        scope: activeTab,
        category: category || undefined,
      })
        .then((next) => { if (active) setResult(next); })
        .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "搜索失败。"); })
        .finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeTab, category, page, query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = draft.trim();
    if (!keyword) return;
    router.push(`/search?q=${encodeURIComponent(keyword)}&tab=${activeTab}`);
  }

  function navigate(next: { tab?: SearchTab; category?: string; page?: number }) {
    const tab = next.tab ?? activeTab;
    const nextCategory = next.category ?? (next.tab && next.tab !== activeTab ? "" : category);
    const params = new URLSearchParams({ q: query, tab });
    if (nextCategory) params.set("category", nextCategory);
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    router.replace(`/search?${params}`);
  }

  const totalPages = activeTab === "articles" ? result?.articles.totalPages ?? 1
    : activeTab === "users" ? result?.users.totalPages ?? 1
      : activeTab === "navigation" ? result?.navigation.totalPages ?? 1
        : activeTab === "tools" ? result?.tools.totalPages ?? 1 : 1;
  const filters = activeTab === "articles" ? result?.filters.articleCategories ?? []
    : activeTab === "navigation" ? result?.filters.navigationCategories ?? []
      : activeTab === "tools" ? result?.filters.toolCategories ?? [] : [];
  const total = (result?.articles.total ?? 0) + (result?.users.total ?? 0) + (result?.navigation.total ?? 0) + (result?.tools.total ?? 0);

  return <section className="page-shell search-page">
    <form className="search-page-field" onSubmit={submit}><Search aria-hidden="true" size={21} /><input aria-label="全站搜索" autoFocus onChange={(event) => setDraft(event.target.value)} placeholder="搜索文章、用户、导航和工具" value={draft} />{draft ? <button aria-label="清空" onClick={() => setDraft("")} type="button"><X aria-hidden="true" size={17} /></button> : null}</form>
    {query ? <nav className="search-tabs"><SearchTabButton active={activeTab === "all"} count={total} label="全部" onClick={() => navigate({ tab: "all" })} /><SearchTabButton active={activeTab === "articles"} count={result?.articles.total ?? 0} label="文章" onClick={() => navigate({ tab: "articles" })} /><SearchTabButton active={activeTab === "users"} count={result?.users.total ?? 0} label="用户" onClick={() => navigate({ tab: "users" })} /><SearchTabButton active={activeTab === "navigation"} count={result?.navigation.total ?? 0} label="导航" onClick={() => navigate({ tab: "navigation" })} /><SearchTabButton active={activeTab === "tools"} count={result?.tools.total ?? 0} label="工具" onClick={() => navigate({ tab: "tools" })} /></nav> : null}
    {filters.length ? <SearchFilters active={category} items={filters} onChange={(value) => navigate({ category: value, page: 1 })} /> : null}
    {isLoading ? <div className="search-page-empty">正在搜索。</div> : null}
    {!isLoading && !query ? <div className="search-page-empty"><Search aria-hidden="true" size={28} /><strong>搜索 HLOVET</strong><span>文章、公开用户资料、导航和工具会集中展示。</span></div> : null}
    {!isLoading && result ? <div className="search-page-results">
      {(activeTab === "all" || activeTab === "articles") && result.articles.total ? <SearchResultSection count={result.articles.total} icon={FileText} title="文章"><div className="search-article-list">{result.articles.items.map((article) => <Link className="search-article-row" href={`/articles/${article.slug}`} key={article.id}><span><strong>{article.title}</strong><small>{article.author.nickname} · {article.category || "随笔"} · {formatTime(article.publishedAt)}</small></span><span>{article.tags.slice(0, 3).map((tag) => <em key={tag}>#{tag}</em>)}</span><b>{article.viewCount} 阅读 · {article.commentCount} 评论</b></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "users") && result.users.total ? <SearchResultSection count={result.users.total} icon={UserRound} title="用户"><div className="search-user-grid">{result.users.items.map((user) => <Link href={`/users/${encodeURIComponent(user.username)}`} key={user.id}><span className="search-user-avatar">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><span><strong>{user.nickname}</strong><small>@{user.username}</small><p>{user.profileBio}</p></span><RoleSymbol code={user.isSuperAdmin ? "super_administrator" : user.role.code} /></Link>)}</div></SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "navigation") && result.navigation.total ? <EntrySection count={result.navigation.total} entries={result.navigation.items} icon={Compass} title="导航" /> : null}
      {(activeTab === "all" || activeTab === "tools") && result.tools.total ? <EntrySection count={result.tools.total} entries={result.tools.items} icon={Wrench} title="工具" /> : null}
      {!total ? <div className="search-page-empty"><strong>没有找到匹配内容</strong><span>换一个关键词或分类再试试。</span></div> : null}
    </div> : null}
    {result && totalPages > 1 ? <nav className="admin-pagination search-pagination" aria-label="搜索结果分页"><span>第 {page} / {totalPages} 页</span><div><button disabled={page <= 1} onClick={() => navigate({ page: page - 1 })} type="button">上一页</button><button disabled={page >= totalPages} onClick={() => navigate({ page: page + 1 })} type="button">下一页</button></div></nav> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function EntrySection({ count, entries, icon, title }: { count: number; entries: GlobalSearchResult["navigation"]["items"]; icon: typeof Search; title: string }) {
  const Icon = icon;
  return <SearchResultSection count={count} icon={Icon} title={title}><div className="search-entry-grid">{entries.map((entry) => entry.url ? <a href={entry.url} key={entry.id} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="search-entry-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Icon aria-hidden="true" size={22} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small><p>{entry.description || "暂无说明"}</p></span><ExternalLink aria-hidden="true" size={15} /></a> : null)}</div></SearchResultSection>;
}

function SearchFilters({ active, items, onChange }: { active: string; items: SearchCategoryFilter[]; onChange: (value: string) => void }) {
  return <div className="search-category-filters"><button className={!active ? "active" : undefined} onClick={() => onChange("")} type="button">全部分类</button>{items.map((item) => <button className={active === item.value ? "active" : undefined} key={item.value} onClick={() => onChange(item.value)} type="button">{item.name}</button>)}</div>;
}

function SearchTabButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} type="button"><span>{label}</span><b>{count}</b></button>;
}

function SearchResultSection({ count, icon: Icon, title, children }: { count: number; icon: typeof Search; title: string; children: React.ReactNode }) {
  return <section className="search-result-section"><header><span><Icon aria-hidden="true" size={17} /><strong>{title}</strong></span><small>{count} 条结果</small></header>{children}</section>;
}

function normalizeTab(value: string | null): SearchTab {
  return value === "articles" || value === "users" || value === "navigation" || value === "tools" ? value : "all";
}

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
