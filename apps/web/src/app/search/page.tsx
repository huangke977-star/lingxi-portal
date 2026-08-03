"use client";

/* eslint-disable @next/next/no-img-element */

import { ExternalLink, FileText, Search, UserRound, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { globalSearch, GlobalSearchResult } from "@/lib/search-api";
import { getAvatarFallbackText } from "@/lib/user-display";

type SearchTab = "all" | "articles" | "users" | "entries";

export default function SearchPage() {
  return <Suspense><SearchContent /></Suspense>;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const activeTab = normalizeTab(searchParams.get("tab"));
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  return <SearchResults activeTab={activeTab} key={query} page={page} query={query} />;
}

function SearchResults({ activeTab, page, query }: { activeTab: SearchTab; page: number; query: string }) {
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
      globalSearch(query, { accessToken: readAccessToken(), page, pageSize: 12 })
        .then((next) => { if (active) setResult(next); })
        .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "搜索失败。"); })
        .finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [page, query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = draft.trim();
    if (!keyword) return;
    router.push(`/search?q=${encodeURIComponent(keyword)}&tab=${activeTab}`);
  }

  function switchTab(tab: SearchTab) {
    router.replace(`/search?q=${encodeURIComponent(query)}&tab=${tab}`);
  }

  const totalPages = activeTab === "articles"
    ? result?.articles.totalPages ?? 1
    : activeTab === "users"
      ? result?.users.totalPages ?? 1
      : activeTab === "entries"
        ? result?.entries.totalPages ?? 1
        : Math.max(result?.articles.totalPages ?? 1, result?.users.totalPages ?? 1, result?.entries.totalPages ?? 1);

  return <section className="page-shell search-page">
    <form className="search-page-field" onSubmit={submit}>
      <Search aria-hidden="true" size={21} />
      <input aria-label="全站搜索" autoFocus onChange={(event) => setDraft(event.target.value)} placeholder="搜索文章、用户、导航和工具" value={draft} />
      {draft ? <button aria-label="清空" onClick={() => setDraft("")} type="button"><X aria-hidden="true" size={17} /></button> : null}
    </form>

    {query ? <nav className="search-tabs">
      <SearchTabButton active={activeTab === "all"} count={(result?.articles.total ?? 0) + (result?.users.total ?? 0) + (result?.entries.total ?? 0)} label="全部" onClick={() => switchTab("all")} />
      <SearchTabButton active={activeTab === "articles"} count={result?.articles.total ?? 0} label="文章" onClick={() => switchTab("articles")} />
      <SearchTabButton active={activeTab === "users"} count={result?.users.total ?? 0} label="用户" onClick={() => switchTab("users")} />
      <SearchTabButton active={activeTab === "entries"} count={result?.entries.total ?? 0} label="导航与工具" onClick={() => switchTab("entries")} />
    </nav> : null}

    {isLoading ? <div className="search-page-empty">正在搜索。</div> : null}
    {!isLoading && !query ? <div className="search-page-empty"><Search aria-hidden="true" size={28} /><strong>搜索 HLOVET</strong><span>文章、公开用户资料、导航和工具会集中展示。</span></div> : null}
    {!isLoading && result ? <div className="search-page-results">
      {(activeTab === "all" || activeTab === "articles") && result.articles.total ? <SearchResultSection count={result.articles.total} icon={FileText} title="文章">
        <div className="search-article-list">{result.articles.items.map((article) => <Link className="search-article-row" href={`/articles/${article.slug}`} key={article.id}><span><strong>{article.title}</strong><small>{article.author.nickname} · {article.category || "随笔"} · {formatTime(article.publishedAt)}</small></span><span>{article.tags.slice(0, 3).map((tag) => <em key={tag}>#{tag}</em>)}</span><b>{article.viewCount} 阅读 · {article.commentCount} 评论</b></Link>)}</div>
      </SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "users") && result.users.total ? <SearchResultSection count={result.users.total} icon={UserRound} title="用户">
        <div className="search-user-grid">{result.users.items.map((user) => <Link href={`/users/${encodeURIComponent(user.username)}`} key={user.id}><span className="search-user-avatar">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><span><strong>{user.nickname}</strong><small>@{user.username}</small><p>{user.profileBio}</p></span><RoleSymbol code={user.isSuperAdmin ? "super_administrator" : user.role.code} /></Link>)}</div>
      </SearchResultSection> : null}
      {(activeTab === "all" || activeTab === "entries") && result.entries.total ? <SearchResultSection count={result.entries.total} icon={Wrench} title="导航与工具">
        <div className="search-entry-grid">{result.entries.items.map((entry) => entry.url ? <a href={entry.url} key={entry.id} rel="noreferrer" target={entry.openInNewTab ? "_blank" : undefined}><span className="search-entry-icon">{entry.iconPath ? <img alt="" src={entry.iconPath} /> : <Wrench aria-hidden="true" size={22} />}</span><span><strong>{entry.title}</strong><small>{entry.category.name}</small><p>{entry.description || "暂无说明"}</p></span><ExternalLink aria-hidden="true" size={15} /></a> : null)}</div>
      </SearchResultSection> : null}
      {!result.articles.total && !result.users.total && !result.entries.total ? <div className="search-page-empty"><strong>没有找到匹配内容</strong><span>换一个关键词再试试。</span></div> : null}
    </div> : null}

    {result && totalPages > 1 ? <nav className="admin-pagination search-pagination" aria-label="搜索结果分页"><span>第 {page} / {totalPages} 页</span><div><button disabled={page <= 1} onClick={() => router.replace(`/search?q=${encodeURIComponent(query)}&tab=${activeTab}&page=${page - 1}`)} type="button">上一页</button><button disabled={page >= totalPages} onClick={() => router.replace(`/search?q=${encodeURIComponent(query)}&tab=${activeTab}&page=${page + 1}`)} type="button">下一页</button></div></nav> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function SearchTabButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick} type="button"><span>{label}</span><b>{count}</b></button>;
}

function SearchResultSection({ count, icon: Icon, title, children }: { count: number; icon: typeof Search; title: string; children: React.ReactNode }) {
  return <section className="search-result-section"><header><span><Icon aria-hidden="true" size={17} /><strong>{title}</strong></span><small>{count} 条结果</small></header>{children}</section>;
}

function normalizeTab(value: string | null): SearchTab {
  return value === "articles" || value === "users" || value === "entries" ? value : "all";
}

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
