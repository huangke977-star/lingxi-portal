"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleBackToTop, ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { ArticleList, listPublicArticles, listVisibleArticles } from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function ArticlesPage() {
  return <Suspense fallback={<section className="page-shell articles-page"><div className="article-empty-state">正在读取文章。</div></section>}><ArticlesContent /></Suspense>;
}

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

function ArticlesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const querySort = searchParams.get("sort") === "popular" ? "popular" : "latest";
  const [searchInput, setSearchInput] = useState(querySearch);
  const [list, setList] = useState<ArticleList>(emptyList);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const composingRef = useRef(false);

  function replaceQuery(next: { q?: string; sort?: "latest" | "popular" }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = next.q ?? querySearch;
    const nextSort = next.sort ?? querySort;
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    if (nextSort === "popular") params.set("sort", nextSort);
    else params.delete("sort");
    params.delete("page");
    router.replace(`/articles${params.size ? `?${params}` : ""}`);
  }

  useEffect(() => {
    if (composingRef.current || searchInput === querySearch) return;
    const timer = window.setTimeout(() => replaceQuery({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
    // Search is represented in the URL so refresh and back navigation remain stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySearch, searchInput]);

  useEffect(() => {
    let active = true;
    const token = readAccessToken();
    // Authentication is stored outside React and must be synchronized after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoggedIn(Boolean(token));
    // URL changes start a new request cycle for the feed.
    setIsLoading(true);
    setList(emptyList);
    const listRequest = token
      ? listVisibleArticles(token, { page: 1, search: querySearch, sort: querySort, pageSize: 12 })
      : listPublicArticles({ page: 1, search: querySearch, sort: querySort, pageSize: 12 });
    Promise.all([token ? getMe(token) : Promise.resolve(null), listRequest])
      .then(([currentUser, result]) => {
        if (!active) return;
        setUser(currentUser);
        setList(result);
      })
      .catch(async (loadError) => {
        if (!active) return;
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          const result = await listPublicArticles({ page: 1, search: querySearch, sort: querySort, pageSize: 12 });
          if (!active) return;
          setUser(null);
          setList(result);
          setIsLoggedIn(false);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "文章加载失败。");
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [querySearch, querySort]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const nextPage = list.page + 1;
    const token = readAccessToken();
    setIsLoadingMore(true);
    const request = token
      ? listVisibleArticles(token, { page: nextPage, search: querySearch, sort: querySort, pageSize: 12 })
      : listPublicArticles({ page: nextPage, search: querySearch, sort: querySort, pageSize: 12 });
    request
      .then((result) => setList((current) => appendArticlePage(current, result)))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "文章加载失败。"))
      .finally(() => setIsLoadingMore(false));
  }, [isLoading, isLoadingMore, list.page, list.totalPages, querySearch, querySort]);

  return (
    <section className="page-shell articles-page">
      <ArticleCenterNav active="discover" isLoggedIn={isLoggedIn} user={user} />

      <div className="article-feed-toolbar">
        <label className="article-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="搜索文章"
            name="search"
            onChange={(event) => setSearchInput(event.target.value)}
            onCompositionEnd={(event) => { composingRef.current = false; setSearchInput(event.currentTarget.value); }}
            onCompositionStart={() => { composingRef.current = true; }}
            placeholder="搜索标题、正文、标签或作者"
            value={searchInput}
          />
          {searchInput ? <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button"><X aria-hidden="true" size={16} /></button> : null}
        </label>
        <div className="article-sort-tabs" role="tablist">
          {([[
            "latest",
            "最新",
          ], ["popular", "热门"]] as const).map(([value, label]) => (
            <button aria-selected={querySort === value} className={querySort === value ? "active" : undefined} key={value} onClick={() => replaceQuery({ sort: value })} role="tab" type="button">{label}</button>
          ))}
        </div>
      </div>

      {isLoading ? <div className="article-empty-state">正在读取文章。</div> : list.items.length ? <div className="article-feed-list">{list.items.map((article) => <ArticleCard article={article} key={article.id} />)}</div> : <div className="article-empty-state"><strong>还没有找到文章</strong><span>{querySearch ? "换一个关键词试试。" : "这里还没有发布内容。"}</span></div>}
      {list.items.length ? <ArticleInfiniteFooter hasMore={list.page < list.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
      <ArticleBackToTop />
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
