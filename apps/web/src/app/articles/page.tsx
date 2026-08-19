"use client";

import { ArrowRight, BookOpen, FolderOpen, Search, SlidersHorizontal, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import {
  ArticleList,
  listPublicArticles,
  listVisibleArticles,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { listDiscoveryRecommendations, subscribeCollection, subscribeTopic, unsubscribeCollection, unsubscribeTopic, type DiscoveryRecommendations } from "@/lib/discovery-api";
import { requestChatGroupJoin } from "@/lib/social-api";

type DiscoverFeed = "recommended" | "latest" | "popular";
type DiscoverOrder = "default" | "latest" | "popular" | "views" | "likes" | "favorites" | "comments";

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };
const ARTICLE_ORDER_OPTIONS: ReadonlyArray<{ label: string; value: DiscoverOrder }> = [
  { label: "默认", value: "default" },
  { label: "最新发布", value: "latest" },
  { label: "综合热度", value: "popular" },
  { label: "浏览最多", value: "views" },
  { label: "点赞最多", value: "likes" },
  { label: "收藏最多", value: "favorites" },
  { label: "评论最多", value: "comments" },
];

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
  const [recommendations, setRecommendations] = useState<DiscoveryRecommendations | null>(null);
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
      Promise.all([token ? getMe(token) : Promise.resolve(null), request, token ? listDiscoveryRecommendations(token).catch(() => null) : Promise.resolve(null)])
      .then(([currentUser, result, nextRecommendations]) => {
        if (!active) return;
        setUser(currentUser);
        setList(result);
        setRecommendations(nextRecommendations);
      })
      .catch(async (loadError) => {
        if (!active) return;
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          setUser(null);
          setIsLoggedIn(false);
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

  async function toggleTopic(id: number, subscribed: boolean) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const result = subscribed ? await unsubscribeTopic(token, id) : await subscribeTopic(token, id);
      setRecommendations((current) => current ? { ...current, topics: current.topics.map((item) => item.id === id ? { ...item, subscribed: result.subscribed, subscriberCount: result.subscriberCount } : item) } : current);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "专题订阅失败。"); }
  }

  async function toggleCollection(id: number, subscribed: boolean) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const result = subscribed ? await unsubscribeCollection(token, id) : await subscribeCollection(token, id);
      setRecommendations((current) => current ? { ...current, collections: current.collections.map((item) => item.id === id ? { ...item, subscribed: result.subscribed, subscriberCount: result.subscriberCount } : item) } : current);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "合集订阅失败。"); }
  }

  async function joinRecommendedGroup(id: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await requestChatGroupJoin(token, id);
      setRecommendations((current) => current ? { ...current, groups: current.groups.filter((group) => group.id !== id) } : current);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "申请加入群聊失败。"); }
  }

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const token = readAccessToken();
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

  return (
    <section className="page-shell articles-page">
      <ArticleCenterNav active="discover" isLoggedIn={isLoggedIn} user={user} />
      <div className="article-discovery-tabs article-center-secondary-tabs" role="tablist">
        {([
          ["recommended", "推荐"],
          ["latest", "最新"],
          ["popular", "热门"],
        ] as const).map(([value, label]) => (
          <button aria-selected={feed === value} className={feed === value ? "active" : undefined} key={value} onClick={() => replaceQuery({ feed: value, order: "default" })} role="tab" type="button">{label}</button>
        ))}
      </div>
      <div className="article-discovery-layout">
        <div className="article-discovery-main">
          <div className="article-feed-toolbar">
            <label className="article-search">
              <Search aria-hidden="true" size={17} />
              <input aria-label="搜索文章" name="search" onChange={(event) => setSearchInput(event.target.value)} onCompositionEnd={(event) => { composingRef.current = false; setSearchInput(event.currentTarget.value); }} onCompositionStart={() => { composingRef.current = true; }} placeholder="搜索标题、正文、标签或作者" value={searchInput} />
              {searchInput ? <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button"><X aria-hidden="true" size={16} /></button> : null}
            </label>
            <div className="article-order-select"><SlidersHorizontal aria-hidden="true" size={16} /><GlassSelect ariaLabel="文章排序" onChange={(value) => replaceQuery({ order: value })} options={ARTICLE_ORDER_OPTIONS} value={order} /></div>
          </div>
          {isLoading ? <div className="article-empty-state">正在读取文章。</div>
            : list.items.length ? <div className="article-feed-list">{list.items.map((article) => <ArticleCard article={article} key={article.id} />)}</div>
              : <div className="article-empty-state"><strong>还没有找到文章</strong><span>{querySearch ? "换一个关键词试试。" : "这里还没有发布内容。"}</span></div>}
          {list.items.length ? <ArticleInfiniteFooter hasMore={list.page < list.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
        </div>
        {recommendations ? <DiscoveryRecommendationsPanel recommendations={recommendations} onJoinGroup={joinRecommendedGroup} onToggleCollection={toggleCollection} onToggleTopic={toggleTopic} /> : null}
      </div>
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}

function DiscoveryRecommendationsPanel({ recommendations, onJoinGroup, onToggleCollection, onToggleTopic }: { recommendations: DiscoveryRecommendations; onJoinGroup: (id: number) => void; onToggleCollection: (id: number, subscribed: boolean) => void; onToggleTopic: (id: number, subscribed: boolean) => void }) {
  return <aside className="discovery-recommendations"><header><span><ArrowRight aria-hidden="true" size={17} /><strong>为你推荐</strong></span></header><div className="discovery-recommendation-columns">
    <div><h2><BookOpen aria-hidden="true" size={15} />专题</h2>{recommendations.topics.slice(0, 3).map((topic) => <article key={topic.id}><Link href={`/topics/${topic.slug}`}><span className="discovery-recommendation-icon">{topic.coverPath ? <img alt="" src={resolveApiUrl(topic.coverPath)} /> : <BookOpen aria-hidden="true" size={17} />}</span><span><strong>{topic.title}</strong><small>{topic.articleCount} 篇 · {topic.subscriberCount} 订阅</small></span></Link><button aria-pressed={topic.subscribed} onClick={() => onToggleTopic(topic.id, topic.subscribed)} type="button">{topic.subscribed ? "已订阅" : "订阅"}</button></article>)}{!recommendations.topics.length ? <p>暂无新专题推荐</p> : null}</div>
    <div><h2><FolderOpen aria-hidden="true" size={15} />合集</h2>{recommendations.collections.slice(0, 3).map((collection) => <article key={collection.id}><Link href={`/collections/${collection.id}`}><span className="discovery-recommendation-icon"><FolderOpen aria-hidden="true" size={17} /></span><span><strong>{collection.name}</strong><small>{collection.articleCount} 篇 · {collection.owner.nickname}</small></span></Link><button aria-pressed={collection.subscribed} onClick={() => onToggleCollection(collection.id, collection.subscribed)} type="button">{collection.subscribed ? "已订阅" : "订阅"}</button></article>)}{!recommendations.collections.length ? <p>暂无新合集推荐</p> : null}</div>
    <div><h2><UsersRound aria-hidden="true" size={15} />活跃群聊</h2>{recommendations.groups.slice(0, 3).map((group) => <article key={group.id}><span className="discovery-recommendation-copy"><span className="discovery-recommendation-icon group">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <UsersRound aria-hidden="true" size={17} />}</span><span><strong>{group.name}</strong><small>{group.memberCount} 位成员 · {group.announcement || "暂无群公告"}</small></span></span>{group.isMember ? <em>已加入</em> : <button onClick={() => onJoinGroup(group.id)} type="button">申请加入</button>}</article>)}{!recommendations.groups.length ? <p>暂无可申请加入的群聊</p> : null}</div>
  </div></aside>;
}

function articleRequest(feed: DiscoverFeed, token: string | null, query: { page: number; pageSize: number; search: string; sort: string }): Promise<ArticleList> {
  return token ? listVisibleArticles(token, query) : listPublicArticles(query);
}

function resolveSort(feed: DiscoverFeed, order: DiscoverOrder): string {
  if (order !== "default") return order;
  if (feed === "latest") return "latest";
  if (feed === "popular") return "popular";
  return "recommended";
}

function normalizeFeed(value: string | null): DiscoverFeed {
  return value === "latest" || value === "popular" ? value : "recommended";
}

function normalizeOrder(value: string | null): DiscoverOrder {
  return value === "latest" || value === "popular" || value === "views" || value === "likes" || value === "favorites" || value === "comments" ? value : "default";
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
