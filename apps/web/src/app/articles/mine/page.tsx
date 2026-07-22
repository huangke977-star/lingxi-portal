"use client";

import Link from "next/link";
import {
  Edit3,
  ExternalLink,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleBackToTop, ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticlePinBadge, ArticleStats, ArticleTaxonomy, RecentCommenters, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  ArticleList,
  ArticleMineSummary,
  ArticleStatus,
  ARTICLE_STATUS_LABEL,
  deleteArticle,
  getMyArticleSummary,
  listMyArticles,
  permanentlyDeleteArticle,
  restoreArticle,
  unpublishArticle,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

const statusTabs: Array<{ value: "all" | ArticleStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "unpublished", label: "已下架" },
  { value: "blocked", label: "受限" },
  { value: "deleted", label: "回收站" },
];

const emptySummary: ArticleMineSummary = {
  total: 0,
  draft: 0,
  published: 0,
  unpublished: 0,
  blocked: 0,
  deleted: 0,
};

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function MyArticlesPage() {
  return <Suspense fallback={<section className="page-shell articles-page"><div className="article-empty-state">正在读取你的文章。</div></section>}><MyArticlesContent /></Suspense>;
}

function MyArticlesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get("status") ?? "all";
  const status = statusTabs.some((tab) => tab.value === rawStatus) ? rawStatus as "all" | ArticleStatus : "all";
  const querySearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(querySearch);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [summary, setSummary] = useState<ArticleMineSummary>(emptySummary);
  const [list, setList] = useState<ArticleList>(emptyList);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const composingRef = useRef(false);

  function replaceQuery(next: { status?: "all" | ArticleStatus; q?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextStatus = next.status ?? status;
    const nextSearch = next.q ?? querySearch;
    if (nextStatus === "all") params.delete("status");
    else params.set("status", nextStatus);
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    params.delete("page");
    router.replace(`/articles/mine${params.size ? `?${params}` : ""}`);
  }

  async function load(token: string) {
    const [currentUser, currentSummary, currentList] = await Promise.all([
      getMe(token),
      getMyArticleSummary(token),
      listMyArticles(token, {
        page: 1,
        pageSize: 12,
        search: querySearch,
        status: status === "all" ? undefined : status,
      }),
    ]);
    setUser(currentUser);
    setSummary(currentSummary);
    setList(currentList);
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
      router.replace("/login?from=%2Farticles%2Fmine");
      return;
    }
    // URL changes start a new request cycle for this protected view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setList(emptyList);
    load(token)
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取文章。");
      })
      .finally(() => setIsLoading(false));
    // The URL owns status and search state; additional pages append in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySearch, router, status]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const token = readAccessToken();
    if (!token) {
      router.replace("/");
      return;
    }
    setIsLoadingMore(true);
    listMyArticles(token, {
      page: list.page + 1,
      pageSize: 12,
      search: querySearch,
      status: status === "all" ? undefined : status,
    })
      .then((result) => setList((current) => appendArticlePage(current, result)))
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取文章。");
      })
      .finally(() => setIsLoadingMore(false));
  }, [isLoading, isLoadingMore, list.page, list.totalPages, querySearch, router, status]);

  async function runAction(action: (token: string) => Promise<unknown>, success: string) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await action(token);
      await load(token);
      setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败。");
    }
  }

  function countFor(tab: "all" | ArticleStatus): number {
    return tab === "all" ? summary.total - summary.deleted : summary[tab];
  }

  return (
    <section className="page-shell articles-page my-articles-page">
      <ArticleCenterNav active="mine" isLoggedIn user={user} />

      <div className="article-mine-toolbar">
        <nav aria-label="文章状态" className="article-status-tabs">
          {statusTabs.map((tab) => (
            <button
              className={status === tab.value ? "active" : undefined}
              key={tab.value}
              onClick={() => replaceQuery({ status: tab.value })}
              type="button"
            >
              {tab.label}<span>{countFor(tab.value)}</span>
            </button>
          ))}
        </nav>
        <label className="article-search article-mine-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="搜索我的文章"
            onChange={(event) => setSearchInput(event.target.value)}
            onCompositionEnd={(event) => { composingRef.current = false; setSearchInput(event.currentTarget.value); }}
            onCompositionStart={() => { composingRef.current = true; }}
            placeholder="搜索我的文章"
            value={searchInput}
          />
          {searchInput ? <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button"><X aria-hidden="true" size={16} /></button> : null}
        </label>
      </div>

      {isLoading ? <div className="article-empty-state">正在读取你的文章。</div> : list.items.length ? (
        <div className="article-mine-list">
          {list.items.map((article) => (
            <article className="article-mine-row" key={article.id}>
              <ArticlePinBadge isPinned={article.isPinned} />
              <div className="article-mine-row-main">
                <div className="article-mine-row-title">
                  <span className={`article-status-dot ${article.status}`}>{ARTICLE_STATUS_LABEL[article.status]}</span>
                  <h2>{article.title}</h2>
                </div>
                {article.status === "blocked" && article.blockedReason ? <div className="article-blocked-reason">受限原因：{article.blockedReason}</div> : null}
                <div className="article-mine-row-meta"><span>更新于 {formatArticleDate(article.updatedAt)}</span><RecentCommenters article={article} /><ArticleStats article={article} compact /><ArticleTaxonomy article={article} limit={4} /></div>
              </div>
              <div className="article-mine-row-actions">
                {article.status !== "deleted" ? <Link href={`/articles/edit/${article.id}`} title="编辑"><Edit3 aria-hidden="true" size={17} /><span>编辑</span></Link> : null}
                {article.status === "published" || article.status === "blocked" ? <Link href={`/articles/${article.slug}`} title="查看"><ExternalLink aria-hidden="true" size={17} /><span>查看</span></Link> : null}
                {article.status === "published" ? <button onClick={() => void runAction((token) => unpublishArticle(token, article.id), "文章已下架。") } type="button">下架</button> : null}
                {article.status === "deleted" ? <button onClick={() => void runAction((token) => restoreArticle(token, article.id), "文章已恢复为草稿。") } type="button"><RotateCcw aria-hidden="true" size={16} /><span>恢复</span></button> : null}
                {article.status === "deleted" ? <button className="text-danger-action" onClick={() => { if (window.confirm(`彻底删除《${article.title}》及其图片吗？此操作无法撤销。`)) void runAction((token) => permanentlyDeleteArticle(token, article.id), "文章已彻底删除。"); }} type="button"><Trash2 aria-hidden="true" size={16} /><span>彻底删除</span></button> : <button className="text-danger-action" onClick={() => { if (window.confirm(`将《${article.title}》移入回收站吗？`)) void runAction((token) => deleteArticle(token, article.id), "文章已移入回收站。"); }} type="button"><Trash2 aria-hidden="true" size={16} /><span>删除</span></button>}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state"><strong>这里还没有文章</strong><span>{querySearch ? "换一个关键词试试。" : status === "deleted" ? "回收站目前是空的。" : "点击右上角“写文章”开始创作。"}</span></div>}

      {list.items.length ? <ArticleInfiniteFooter hasMore={list.page < list.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
      <ArticleBackToTop />
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
