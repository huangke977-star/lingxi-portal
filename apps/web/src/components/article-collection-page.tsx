"use client";

import { Bookmark, Clock3, Heart, History, Search, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  ArticleCenterSummary,
  ArticleList,
  clearArticleReadingHistory,
  getVisibleArticleCenterSummary,
  listFavoriteArticles,
  listLikedArticles,
  listReadLaterArticles,
  listReadingHistory,
  removeArticleReadingHistory,
  setArticleReadLater,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export type ReadingMode = "read-later" | "history" | "favorites" | "liked";

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };
const emptySummary: ArticleCenterSummary = { discover: 0, subscriptions: 0, mine: 0, favorites: 0, liked: 0, readLater: 0, history: 0, manage: 0 };

export function ArticleCollectionPage({ mode }: { mode: ReadingMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(querySearch);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [summary, setSummary] = useState<ArticleCenterSummary>(emptySummary);
  const [list, setList] = useState<ArticleList>(emptyList);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const composingRef = useRef(false);

  function replaceQuery(next: { q?: string; tab?: ReadingMode }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = next.q ?? querySearch;
    const nextTab = next.tab ?? mode;
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    if (nextTab === "read-later") params.delete("tab");
    else params.set("tab", nextTab);
    router.replace(`/articles/reading${params.size ? `?${params}` : ""}`);
  }

  useEffect(() => {
    if (composingRef.current || searchInput === querySearch) return;
    const timer = window.setTimeout(() => replaceQuery({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
    // Query replacement is intentionally driven by the input value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, querySearch]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`/login?from=${encodeURIComponent("/articles/reading")}`);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setList(emptyList);
      Promise.all([
        getMe(token),
        getVisibleArticleCenterSummary(token),
        collectionRequest(mode)(token, { page: 1, pageSize: 12, search: querySearch }),
      ])
      .then(([currentUser, nextSummary, result]) => {
        setUser(currentUser);
        setSummary(nextSummary);
        setList(result);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "阅读记录加载失败。");
      })
      .finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode, querySearch, router]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const token = readAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }
    setIsLoadingMore(true);
    collectionRequest(mode)(token, { page: list.page + 1, pageSize: 12, search: querySearch })
      .then((result) => setList((current) => appendArticlePage(current, result)))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "更多内容加载失败。"))
      .finally(() => setIsLoadingMore(false));
  }, [isLoading, isLoadingMore, list.page, list.totalPages, mode, querySearch, router]);

  async function removeItem(article: Article) {
    const token = readAccessToken();
    if (!token) return;
    try {
      if (mode === "history") await removeArticleReadingHistory(token, article.id);
      else if (mode === "read-later") await setArticleReadLater(token, article.id, false);
      setList((current) => ({ ...current, total: Math.max(0, current.total - 1), items: current.items.filter((item) => item.id !== article.id) }));
      setSummary((current) => ({ ...current, [mode === "history" ? "history" : "readLater"]: Math.max(0, current[mode === "history" ? "history" : "readLater"] - 1) }));
      setNotice(mode === "history" ? "已移除这条阅读记录。" : "已从稍后读移除。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败。");
    }
  }

  async function clearHistory() {
    const token = readAccessToken();
    if (!token || !window.confirm("清空全部阅读历史吗？稍后读、收藏和赞过不会受到影响。")) return;
    try {
      await clearArticleReadingHistory(token);
      setList(emptyList);
      setSummary((current) => ({ ...current, history: 0 }));
      setNotice("阅读历史已清空。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "清空失败。");
    }
  }

  const config = readingConfig(mode);
  return (
    <section className="page-shell articles-page article-collection-page">
      <ArticleCenterNav active="reading" isLoggedIn user={user} />
      <div className="article-reading-tabs" role="tablist">
        {([
          ["read-later", "稍后读", Clock3, summary.readLater],
          ["history", "阅读历史", History, summary.history],
          ["favorites", "收藏", Bookmark, summary.favorites],
          ["liked", "赞过", Heart, summary.liked],
        ] as const).map(([value, label, Icon, count]) => <button aria-selected={mode === value} className={mode === value ? "active" : undefined} key={value} onClick={() => replaceQuery({ tab: value })} role="tab" type="button"><Icon aria-hidden="true" size={15} />{label}<span>{count}</span></button>)}
      </div>
      <div className="article-feed-toolbar article-collection-toolbar">
        <label className="article-search"><Search aria-hidden="true" size={17} /><input aria-label="搜索文章" name="search" onChange={(event) => setSearchInput(event.target.value)} onCompositionEnd={(event) => { composingRef.current = false; setSearchInput(event.currentTarget.value); }} onCompositionStart={() => { composingRef.current = true; }} placeholder="搜索标题、正文、标签或作者" value={searchInput} />{searchInput ? <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button"><X aria-hidden="true" size={16} /></button> : null}</label>
        {mode === "history" && list.total ? <button className="article-clear-history" onClick={() => void clearHistory()} type="button"><Trash2 aria-hidden="true" size={15} />清空历史</button> : null}
      </div>
      {isLoading ? <div className="article-empty-state">正在读取内容。</div>
        : list.items.length ? <div className="article-reading-list">{list.items.map((article) => <div className="article-reading-list-item" key={article.id}><ArticleCard article={article} href={mode === "history" ? `/articles/${article.slug}?resume=1` : undefined} taxonomyPlacement="after-stats" />{mode === "history" ? <div className="article-reading-record"><span><b>{article.readingProgress ?? 1}%</b><i><span style={{ width: `${article.readingProgress ?? 1}%` }} /></i><small>上次阅读 {formatArticleDate(article.lastReadAt)}</small></span><button aria-label="移除阅读记录" onClick={() => void removeItem(article)} title="移除阅读记录" type="button"><Trash2 aria-hidden="true" size={14} /></button></div> : mode === "read-later" ? <div className="article-reading-record compact"><span><small>已加入稍后读</small></span><button aria-label="移出稍后读" onClick={() => void removeItem(article)} title="移出稍后读" type="button"><X aria-hidden="true" size={14} /></button></div> : null}</div>)}</div>
          : <div className="article-empty-state"><config.Icon aria-hidden="true" size={24} /><strong>{querySearch ? "没有匹配的文章" : config.emptyTitle}</strong><span>{querySearch ? "试试其他关键词。" : config.emptyText}</span></div>}
      {list.items.length ? <ArticleInfiniteFooter hasMore={list.page < list.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
      <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function collectionRequest(mode: ReadingMode) {
  if (mode === "history") return listReadingHistory;
  if (mode === "read-later") return listReadLaterArticles;
  if (mode === "favorites") return listFavoriteArticles;
  return listLikedArticles;
}

function readingConfig(mode: ReadingMode) {
  if (mode === "history") return { Icon: History, emptyTitle: "还没有阅读历史", emptyText: "登录后阅读文章，最近阅读位置会保存在这里。" };
  if (mode === "read-later") return { Icon: Clock3, emptyTitle: "还没有稍后读内容", emptyText: "遇到想稍后查看的文章，可以先加入这里。" };
  if (mode === "favorites") return { Icon: Bookmark, emptyTitle: "还没有收藏文章", emptyText: "收藏的文章会长期保存在这里。" };
  return { Icon: Heart, emptyTitle: "还没有点赞文章", emptyText: "点赞过的文章会显示在这里。" };
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
