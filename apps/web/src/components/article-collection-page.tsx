"use client";

import { Bookmark, Clock3, Heart, History, Search, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
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
import { localizedPath } from "@/lib/i18n";

export type ReadingMode = "read-later" | "history" | "favorites" | "liked";

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };
const emptySummary: ArticleCenterSummary = { discover: 0, subscriptions: 0, mine: 0, favorites: 0, liked: 0, readLater: 0, history: 0, manage: 0 };

export function ArticleCollectionPage({ mode }: { mode: ReadingMode }) {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
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
  const [isComposing, setIsComposing] = useState(false);

  function replaceQuery(next: { q?: string; tab?: ReadingMode }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextSearch = next.q ?? querySearch;
    const nextTab = next.tab ?? mode;
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    if (nextTab === "read-later") params.delete("tab");
    else params.set("tab", nextTab);
    router.replace(`${localizedPath("/articles/reading", locale)}${params.size ? `?${params}` : ""}`);
  }

  useEffect(() => {
    if (isComposing || searchInput === querySearch) return;
    const timer = window.setTimeout(() => replaceQuery({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
    // Query replacement is intentionally driven by the input value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComposing, searchInput, querySearch]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/articles/reading", locale))}`);
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
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("阅读记录加载失败。", "Could not load reading activity."));
      })
      .finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [locale, mode, phrase, querySearch, router]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/", locale));
      return;
    }
    setIsLoadingMore(true);
    collectionRequest(mode)(token, { page: list.page + 1, pageSize: 12, search: querySearch })
      .then((result) => setList((current) => appendArticlePage(current, result)))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("更多内容加载失败。", "Could not load more content.")))
      .finally(() => setIsLoadingMore(false));
  }, [isLoading, isLoadingMore, list.page, list.totalPages, locale, mode, phrase, querySearch, router]);

  async function removeItem(article: Article) {
    const token = readAccessToken();
    if (!token) return;
    try {
      if (mode === "history") await removeArticleReadingHistory(token, article.id);
      else if (mode === "read-later") await setArticleReadLater(token, article.id, false);
      setList((current) => ({ ...current, total: Math.max(0, current.total - 1), items: current.items.filter((item) => item.id !== article.id) }));
      setSummary((current) => ({ ...current, [mode === "history" ? "history" : "readLater"]: Math.max(0, current[mode === "history" ? "history" : "readLater"] - 1) }));
      setNotice(mode === "history" ? phrase("已移除这条阅读记录。", "Reading record removed.") : phrase("已从稍后读移除。", "Removed from Read later."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("操作失败。", "Action failed."));
    }
  }

  async function clearHistory() {
    const token = readAccessToken();
    if (!token || !window.confirm(phrase("清空全部阅读历史吗？稍后读、收藏和赞过不会受到影响。", "Clear all reading history? Read later, favorites, and likes will not be affected."))) return;
    try {
      await clearArticleReadingHistory(token);
      setList(emptyList);
      setSummary((current) => ({ ...current, history: 0 }));
      setNotice(phrase("阅读历史已清空。", "Reading history cleared."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("清空失败。", "Could not clear history."));
    }
  }

  function renderReadingAccessory(article: Article) {
    if (mode === "history") {
      const progress = article.readingProgress ?? 1;
      return (
        <span className="article-reading-inline">
          <b>{progress}%</b>
          <i aria-label={phrase(`阅读进度 ${progress}%`, `Reading progress ${progress}%`)}><span style={{ width: `${progress}%` }} /></i>
          <small>{phrase(`上次阅读 ${formatArticleDate(article.lastReadAt)}`, `Last read ${formatArticleDate(article.lastReadAt)}`)}</small>
          <button aria-label={phrase("移除阅读记录", "Remove reading record")} onClick={() => void removeItem(article)} title={phrase("移除阅读记录", "Remove reading record")} type="button">
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </span>
      );
    }
    if (mode === "read-later") {
      return (
        <span className="article-reading-inline compact">
          <small>{phrase("已加入稍后读", "Saved to Read later")}</small>
          <button aria-label={phrase("移出稍后读", "Remove from Read later")} onClick={() => void removeItem(article)} title={phrase("移出稍后读", "Remove from Read later")} type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </span>
      );
    }
    return null;
  }

  const config = readingConfig(mode, phrase);
  return (
    <section className="page-shell articles-page article-collection-page">
      <ArticleCenterNav active="reading" isLoggedIn user={user} />
      <div className="article-reading-tabs article-center-secondary-tabs" role="tablist">
        {([
          ["read-later", phrase("稍后读", "Read later"), Clock3, summary.readLater],
          ["history", phrase("阅读历史", "Reading history"), History, summary.history],
          ["favorites", phrase("收藏", "Favorites"), Bookmark, summary.favorites],
          ["liked", phrase("赞过", "Liked"), Heart, summary.liked],
        ] as const).map(([value, label, Icon, count]) => <button aria-selected={mode === value} className={mode === value ? "active" : undefined} key={value} onClick={() => replaceQuery({ tab: value })} role="tab" type="button"><Icon aria-hidden="true" size={15} />{label}<span>{count}</span></button>)}
      </div>
      <div className="article-feed-toolbar article-collection-toolbar">
        <label className="article-search"><Search aria-hidden="true" size={17} /><input aria-label={phrase("搜索文章", "Search articles")} name="search" onChange={(event) => setSearchInput(event.target.value)} onCompositionEnd={(event) => { setSearchInput(event.currentTarget.value); setIsComposing(false); }} onCompositionStart={() => setIsComposing(true)} placeholder={phrase("搜索标题、正文、标签或作者", "Search titles, content, tags, or authors")} value={searchInput} />{searchInput ? <button aria-label={phrase("清除搜索", "Clear search")} onClick={() => setSearchInput("")} title={phrase("清除搜索", "Clear search")} type="button"><X aria-hidden="true" size={16} /></button> : null}</label>
        {mode === "history" && list.total ? <button className="article-clear-history" onClick={() => void clearHistory()} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("清空历史", "Clear history")}</button> : null}
      </div>
      {isLoading ? <div className="article-empty-state">{phrase("正在读取内容。", "Loading content.")}</div>
        : list.items.length ? <div className="article-reading-list">{list.items.map((article) => <ArticleCard article={article} href={mode === "history" ? `${localizedPath(`/articles/${article.slug}`, locale)}?resume=1` : undefined} key={article.id} metaAccessory={renderReadingAccessory(article)} taxonomyPlacement="after-stats" />)}</div>
          : <div className="article-empty-state"><config.Icon aria-hidden="true" size={24} /><strong>{querySearch ? phrase("没有匹配的文章", "No matching articles") : config.emptyTitle}</strong><span>{querySearch ? phrase("试试其他关键词。", "Try another keyword.") : config.emptyText}</span></div>}
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

function readingConfig(mode: ReadingMode, phrase: (chinese: string, english: string) => string) {
  if (mode === "history") return { Icon: History, emptyTitle: phrase("还没有阅读历史", "No reading history"), emptyText: phrase("登录后阅读文章，最近阅读位置会保存在这里。", "Your latest reading position is saved here after you sign in.") };
  if (mode === "read-later") return { Icon: Clock3, emptyTitle: phrase("还没有稍后读内容", "Nothing saved for later"), emptyText: phrase("遇到想稍后查看的文章，可以先加入这里。", "Save articles here to read them later.") };
  if (mode === "favorites") return { Icon: Bookmark, emptyTitle: phrase("还没有收藏文章", "No favorite articles"), emptyText: phrase("收藏的文章会长期保存在这里。", "Articles you favorite are kept here.") };
  return { Icon: Heart, emptyTitle: phrase("还没有点赞文章", "No liked articles"), emptyText: phrase("点赞过的文章会显示在这里。", "Articles you like appear here.") };
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
