"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  ArticleList,
  listPublicArticles,
  listSubscribedArticles,
  listVisibleArticles,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

type DiscoverFeed = "recommended" | "latest" | "popular" | "subscriptions";
type DiscoverOrder = "default" | "latest" | "popular" | "views" | "likes" | "favorites" | "comments";

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function ArticlesPage() {
  return <Suspense fallback={<section className="page-shell articles-page"><div className="article-empty-state">正在读取文章。</div></section>}><ArticlesContent /></Suspense>;
}

function ArticlesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const feed = normalizeFeed(searchParams.get("feed"));
  const order = normalizeOrder(searchParams.get("order"));
  const [searchInput, setSearchInput] = useState(querySearch);
  const [list, setList] = useState<ArticleList>(emptyList);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const composingRef = useRef(false);

  function replaceQuery(next: { q?: string; feed?: DiscoverFeed; order?: DiscoverOrder }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = next.q ?? querySearch;
    const nextFeed = next.feed ?? feed;
    const nextOrder = next.order ?? order;
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    if (nextFeed === "recommended") params.delete("feed");
    else params.set("feed", nextFeed);
    if (nextOrder === "default") params.delete("order");
    else params.set("order", nextOrder);
    router.replace(`/articles${params.size ? `?${params}` : ""}`);
  }

  useEffect(() => {
    if (composingRef.current || searchInput === querySearch) return;
    const timer = window.setTimeout(() => replaceQuery({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
    // Search state stays in the URL for refresh and back navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySearch, searchInput]);

  useEffect(() => {
    let active = true;
    const token = readAccessToken();
    const timer = window.setTimeout(() => {
      setIsLoggedIn(Boolean(token));
      setIsLoading(true);
      setList(emptyList);
      const request = articleRequest(feed, token, {
        page: 1,
        pageSize: 12,
        search: querySearch,
        sort: resolveSort(feed, order),
      });
      Promise.all([token ? getMe(token) : Promise.resolve(null), request])
      .then(([currentUser, result]) => {
        if (!active) return;
        setUser(currentUser);
        setList(result);
      })
      .catch(async (loadError) => {
        if (!active) return;
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          setUser(null);
          setIsLoggedIn(false);
          if (feed === "subscriptions") {
            setList(emptyList);
            return;
          }
          const result = await listPublicArticles({
            page: 1,
            pageSize: 12,
            search: querySearch,
            sort: resolveSort(feed, order),
          });
          if (active) setList(result);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "文章加载失败。");
      })
      .finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [feed, order, querySearch]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const token = readAccessToken();
    if (feed === "subscriptions" && !token) return;
    setIsLoadingMore(true);
    articleRequest(feed, token, {
      page: list.page + 1,
      pageSize: 12,
      search: querySearch,
      sort: resolveSort(feed, order),
    })
      .then((result) => setList((current) => appendArticlePage(current, result)))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "文章加载失败。"))
      .finally(() => setIsLoadingMore(false));
  }, [feed, isLoading, isLoadingMore, list.page, list.totalPages, order, querySearch]);

  const needsLogin = feed === "subscriptions" && !isLoggedIn;
  return (
    <section className="page-shell articles-page">
      <ArticleCenterNav active="discover" isLoggedIn={isLoggedIn} user={user} />
      <div className="article-discovery-tabs" role="tablist">
        {([
          ["recommended", "推荐"],
          ["latest", "最新"],
          ["popular", "热门"],
          ["subscriptions", "订阅"],
        ] as const).map(([value, label]) => (
          <button aria-selected={feed === value} className={feed === value ? "active" : undefined} key={value} onClick={() => replaceQuery({ feed: value, order: "default" })} role="tab" type="button">{label}</button>
        ))}
      </div>
      <div className="article-feed-toolbar">
        <label className="article-search">
          <Search aria-hidden="true" size={17} />
          <input aria-label="搜索文章" name="search" onChange={(event) => setSearchInput(event.target.value)} onCompositionEnd={(event) => { composingRef.current = false; setSearchInput(event.currentTarget.value); }} onCompositionStart={() => { composingRef.current = true; }} placeholder="搜索标题、正文、标签或作者" value={searchInput} />
          {searchInput ? <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button"><X aria-hidden="true" size={16} /></button> : null}
        </label>
        <label className="article-order-select"><SlidersHorizontal aria-hidden="true" size={16} /><span>排序</span><select aria-label="文章排序" onChange={(event) => replaceQuery({ order: event.target.value as DiscoverOrder })} value={order}><option value="default">默认</option><option value="latest">最新发布</option><option value="popular">综合热度</option><option value="views">浏览最多</option><option value="likes">点赞最多</option><option value="favorites">收藏最多</option><option value="comments">评论最多</option></select></label>
      </div>
      {needsLogin ? <div className="article-empty-state"><strong>登录后查看订阅内容</strong><span>你订阅作者发布的新文章会集中显示在这里。</span><button className="text-action" onClick={() => router.push(`/login?from=${encodeURIComponent("/articles?feed=subscriptions")}`)} type="button">去登录</button></div>
        : isLoading ? <div className="article-empty-state">正在读取文章。</div>
          : list.items.length ? <div className="article-feed-list">{list.items.map((article) => <ArticleCard article={article} key={article.id} />)}</div>
            : <div className="article-empty-state"><strong>还没有找到文章</strong><span>{querySearch ? "换一个关键词试试。" : feed === "subscriptions" ? "订阅作者后，新内容会显示在这里。" : "这里还没有发布内容。"}</span></div>}
      {!needsLogin && list.items.length ? <ArticleInfiniteFooter hasMore={list.page < list.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}

function articleRequest(feed: DiscoverFeed, token: string | null, query: { page: number; pageSize: number; search: string; sort: string }): Promise<ArticleList> {
  if (feed === "subscriptions") return token ? listSubscribedArticles(token, query) : Promise.resolve(emptyList);
  return token ? listVisibleArticles(token, query) : listPublicArticles(query);
}

function resolveSort(feed: DiscoverFeed, order: DiscoverOrder): string {
  if (order !== "default") return order;
  if (feed === "latest" || feed === "subscriptions") return "latest";
  if (feed === "popular") return "popular";
  return "recommended";
}

function normalizeFeed(value: string | null): DiscoverFeed {
  return value === "latest" || value === "popular" || value === "subscriptions" ? value : "recommended";
}

function normalizeOrder(value: string | null): DiscoverOrder {
  return value === "latest" || value === "popular" || value === "views" || value === "likes" || value === "favorites" || value === "comments" ? value : "default";
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
