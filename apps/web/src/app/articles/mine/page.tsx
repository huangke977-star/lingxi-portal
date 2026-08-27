"use client";

import Link from "next/link";
import {
  Bookmark,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleX,
  Clock3,
  Coins,
  Edit3,
  Eye,
  ExternalLink,
  Heart,
  MessageCircle,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArticleCenterNav, ArticleMineSecondaryNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticlePinBadge, ArticleStats, ArticleTaxonomy, RecentCommenters, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import {
  ArticleList,
  ArticleMineDashboard,
  ArticleMineSummary,
  ArticleStatus,
  Article,
  ArticleScheduleItem,
  cancelArticleSchedule,
  deleteArticle,
  createArticleAppeal,
  getMyArticleDashboard,
  getMyArticleSummary,
  listMyArticles,
  listMyArticleSchedules,
  permanentlyDeleteArticle,
  restoreArticle,
  unpublishArticle,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";

const statusValues: Array<"all" | ArticleStatus> = ["all", "draft", "published", "unpublished", "blocked", "deleted"];

const emptySummary: ArticleMineSummary = {
  total: 0,
  draft: 0,
  published: 0,
  unpublished: 0,
  blocked: 0,
  deleted: 0,
};
const emptyDashboard: ArticleMineDashboard = {
  views: 0,
  likes: 0,
  comments: 0,
  favorites: 0,
  resourceExchanges: 0,
  pendingPoints: 0,
  settledPoints: 0,
  recentResourceIncome: [],
};

const emptyList: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function MyArticlesPage() {
  return <Suspense fallback={<MyArticlesFallback />}><MyArticlesContent /></Suspense>;
}

function MyArticlesFallback() {
  const { phrase } = useLanguage();
  return <section className="page-shell articles-page"><div className="article-empty-state">{phrase("正在读取你的文章。", "Loading your articles.")}</div></section>;
}

function MyArticlesContent() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const searchParams = useSearchParams();
  const rawStatus = searchParams.get("status") ?? "all";
  const status = statusValues.some((value) => value === rawStatus) ? rawStatus as "all" | ArticleStatus : "all";
  const querySearch = searchParams.get("q") ?? "";
  const statusLabel = (value: ArticleStatus) => value === "draft"
    ? phrase("草稿", "Draft")
    : value === "published"
      ? phrase("已发布", "Published")
      : value === "unpublished"
        ? phrase("已下架", "Unpublished")
        : value === "blocked"
          ? phrase("受限", "Restricted")
          : phrase("回收站", "Recycle bin");
  const [searchInput, setSearchInput] = useState(querySearch);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [summary, setSummary] = useState<ArticleMineSummary>(emptySummary);
  const [dashboard, setDashboard] = useState<ArticleMineDashboard>(emptyDashboard);
  const [schedules, setSchedules] = useState<ArticleScheduleItem[]>([]);
  const [list, setList] = useState<ArticleList>(emptyList);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [appealArticle, setAppealArticle] = useState<Article | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [isAppealSaving, setIsAppealSaving] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isCreatorDashboardOpen, setIsCreatorDashboardOpen] = useState(false);

  function replaceQuery(next: { status?: "all" | ArticleStatus; q?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const nextStatus = next.status ?? status;
    const nextSearch = next.q ?? querySearch;
    if (nextStatus === "all") params.delete("status");
    else params.set("status", nextStatus);
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    else params.delete("q");
    params.delete("page");
    router.replace(`${localizedPath("/articles/mine", locale)}${params.size ? `?${params}` : ""}`);
  }

  async function load(token: string) {
    const [currentUser, currentSummary, currentDashboard, currentList, currentSchedules] = await Promise.all([
      getMe(token),
      getMyArticleSummary(token),
      getMyArticleDashboard(token),
      listMyArticles(token, {
        page: 1,
        pageSize: 12,
        search: querySearch,
        status: status === "all" ? undefined : status,
      }),
      listMyArticleSchedules(token),
    ]);
    setUser(currentUser);
    setSummary(currentSummary);
    setDashboard(currentDashboard);
    setList(currentList);
    setSchedules(currentSchedules.items);
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
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/articles/mine", locale))}`);
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
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("无法读取文章。", "Could not load articles."));
      })
      .finally(() => setIsLoading(false));
    // The URL owns status and search state; additional pages append in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, phrase, querySearch, router, status]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || list.page >= list.totalPages) return;
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/", locale));
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
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("无法读取文章。", "Could not load articles."));
      })
      .finally(() => setIsLoadingMore(false));
  }, [isLoading, isLoadingMore, list.page, list.totalPages, locale, phrase, querySearch, router, status]);

  async function runAction(action: (token: string) => Promise<unknown>, success: string) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await action(token);
      await load(token);
      setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("操作失败。", "Action failed."));
    }
  }

  return (
    <section className="page-shell articles-page my-articles-page">
      <ArticleCenterNav active="mine" isLoggedIn user={user} />
      <div className="article-mine-layout">
        <aside className={`article-mine-sidebar${isCreatorDashboardOpen ? " is-open" : ""}`}>
          <button aria-expanded={isCreatorDashboardOpen} className="side-panel-mobile-toggle" onClick={() => setIsCreatorDashboardOpen((current) => !current)} type="button">
            <span>{phrase("创作数据", "Creator data")}</span>{isCreatorDashboardOpen ? <ChevronUp aria-hidden="true" size={15} /> : <ChevronDown aria-hidden="true" size={15} />}
          </button>
          <section aria-label={phrase("创作者数据", "Creator dashboard")} className="article-creator-dashboard">
            <div className="article-creator-metrics">
              {[
                { icon: Eye, label: phrase("文章阅读", "Article views"), value: dashboard.views },
                { icon: Heart, label: phrase("获得点赞", "Likes received"), value: dashboard.likes },
                { icon: MessageCircle, label: phrase("收到评论", "Comments received"), value: dashboard.comments },
                { icon: Bookmark, label: phrase("被收藏", "Favorites received"), value: dashboard.favorites },
                { icon: Coins, label: phrase("资源兑换", "Resource unlocks"), value: dashboard.resourceExchanges },
                { icon: Clock3, label: phrase("待入账积分", "Pending points"), value: dashboard.pendingPoints },
                { icon: CheckCircle2, label: phrase("已到账积分", "Settled points"), value: dashboard.settledPoints },
              ].map(({ icon: Icon, label, value }) => <div key={label}><Icon aria-hidden="true" size={16} /><span><small>{label}</small><strong>{value.toLocaleString(locale)}</strong></span></div>)}
            </div>
            <div className="article-resource-income">
              <header><span><Coins aria-hidden="true" size={15} /><strong>{phrase("资源收益明细", "Resource income")}</strong></span><Link href={localizedPath("/profile/points", locale)}>{phrase("全部积分记录", "All point activity")}</Link></header>
              {dashboard.recentResourceIncome.length ? <div>{dashboard.recentResourceIncome.map((income) => <Link href={localizedPath(`/articles/${income.article.slug}`, locale)} key={income.id}><span><strong>{income.article.title}</strong><small>{phrase(`兑换于 ${formatArticleDate(income.createdAt, locale)}`, `Unlocked ${formatArticleDate(income.createdAt, locale)}`)}</small></span><span><b><Coins aria-hidden="true" size={13} />{income.pointCost}</b><small className={income.settledAt ? "settled" : "pending"}>{income.settledAt ? phrase(`已于 ${formatArticleDate(income.settledAt, locale)}到账`, `Settled ${formatArticleDate(income.settledAt, locale)}`) : phrase(`预计 ${formatArticleDate(income.availableAt, locale)}到账`, `Expected ${formatArticleDate(income.availableAt, locale)}`)}</small></span></Link>)}</div> : <p>{phrase("资源兑换后会在这里显示作者收益和到账状态。", "Resource unlocks will show their income and settlement status here.")}</p>}
            </div>
            <div className="article-schedule-list">
              <header><span><CalendarClock aria-hidden="true" size={15} /><strong>{phrase("发布计划", "Publishing schedule")}</strong></span><small>{schedules.length}</small></header>
              {schedules.length ? <div>{schedules.map((item) => <div className="article-schedule-row" key={item.id}><Link href={localizedPath(`/articles/edit/${item.id}`, locale)}><span><strong>{item.title || phrase("未命名文章", "Untitled article")}</strong><small>{item.publishAt ? phrase(`发布于 ${formatArticleDate(item.publishAt, locale)}`, `Publishes ${formatArticleDate(item.publishAt, locale)}`) : item.unpublishAt ? phrase(`下线于 ${formatArticleDate(item.unpublishAt, locale)}`, `Unpublishes ${formatArticleDate(item.unpublishAt, locale)}`) : phrase("执行失败，请重新设置", "Execution failed, reschedule it")}</small></span><CalendarClock aria-hidden="true" size={14} /></Link><button aria-label={phrase(`取消 ${item.title || "文章"} 的发布计划`, `Cancel schedule for ${item.title || "article"}`)} className="article-schedule-cancel-button" onClick={() => void runAction((token) => cancelArticleSchedule(token, item.id), phrase("文章发布计划已取消。", "Article schedule cancelled."))} title={phrase("取消发布计划", "Cancel schedule")} type="button"><CircleX aria-hidden="true" size={15} /></button></div>)}</div> : <p>{phrase("还没有安排发布或下线的文章。", "No articles are scheduled to publish or go offline.")}</p>}
            </div>
          </section>
        </aside>
        <div className="article-mine-main">
      <div className="article-mine-toolbar">
        <ArticleMineSecondaryNav active={status} search={querySearch} summary={summary} />
        <label className="article-search article-mine-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-label={phrase("搜索我的文章", "Search my articles")}
            onChange={(event) => setSearchInput(event.target.value)}
            onCompositionEnd={(event) => { setSearchInput(event.currentTarget.value); setIsComposing(false); }}
            onCompositionStart={() => setIsComposing(true)}
            placeholder={phrase("搜索我的文章", "Search my articles")}
            value={searchInput}
          />
          {searchInput ? <button aria-label={phrase("清除搜索", "Clear search")} onClick={() => setSearchInput("")} title={phrase("清除搜索", "Clear search")} type="button"><X aria-hidden="true" size={16} /></button> : null}
        </label>
      </div>

      {isLoading ? <div className="article-empty-state">{phrase("正在读取你的文章。", "Loading your articles.")}</div> : list.items.length ? (
        <div className="article-mine-list">
          {list.items.map((article) => (
            <article className="article-mine-row" key={article.id}>
              <ArticlePinBadge isPinned={article.isPinned} />
              <div className="article-mine-row-main">
                <div className="article-mine-row-title">
                  <span className={`article-status-dot ${article.status}`}>{statusLabel(article.status)}</span>
                  <h2>{article.title}</h2>
                </div>
                {article.status === "blocked" && article.blockedReason ? <div className="article-blocked-reason">{phrase("受限原因：", "Restriction reason: ")}{article.blockedReason}</div> : null}
                <div className="article-mine-row-meta"><span>{phrase(`更新于 ${formatArticleDate(article.updatedAt, locale)}`, `Updated ${formatArticleDate(article.updatedAt, locale)}`)}</span><ArticleTaxonomy article={article} limit={4} /><ArticleStats article={article} compact /><RecentCommenters article={article} /></div>
              </div>
              <div className="article-mine-row-actions">
                {article.status !== "deleted" ? <Link href={localizedPath(`/articles/edit/${article.id}`, locale)} title={phrase("编辑", "Edit")}><Edit3 aria-hidden="true" size={17} /><span>{phrase("编辑", "Edit")}</span></Link> : null}
                {article.status === "published" || article.status === "blocked" ? <Link href={localizedPath(`/articles/${article.slug}`, locale)} title={phrase("查看", "View")}><ExternalLink aria-hidden="true" size={17} /><span>{phrase("查看", "View")}</span></Link> : null}
                {article.status === "blocked" ? <button onClick={() => { setAppealArticle(article); setAppealReason(""); }} title={phrase("申诉", "Appeal")} type="button">{phrase("申诉", "Appeal")}</button> : null}
                {article.status === "published" ? <button onClick={() => void runAction((token) => unpublishArticle(token, article.id), phrase("文章已下架。", "Article unpublished.")) } type="button">{phrase("下架", "Unpublish")}</button> : null}
                {article.status === "deleted" ? <button onClick={() => void runAction((token) => restoreArticle(token, article.id), phrase("文章已恢复为草稿。", "Article restored as a draft.")) } type="button"><RotateCcw aria-hidden="true" size={16} /><span>{phrase("恢复", "Restore")}</span></button> : null}
                {article.status === "deleted" ? <button className="text-danger-action" onClick={() => { if (window.confirm(phrase(`彻底删除《${article.title}》及其图片吗？此操作无法撤销。`, `Permanently delete “${article.title}” and its images? This cannot be undone.`))) void runAction((token) => permanentlyDeleteArticle(token, article.id), phrase("文章已彻底删除。", "Article permanently deleted.")); }} type="button"><Trash2 aria-hidden="true" size={16} /><span>{phrase("彻底删除", "Delete permanently")}</span></button> : <button className="text-danger-action" onClick={() => { if (window.confirm(phrase(`将《${article.title}》移入回收站吗？`, `Move “${article.title}” to the recycle bin?`))) void runAction((token) => deleteArticle(token, article.id), phrase("文章已移入回收站。", "Article moved to the recycle bin.")); }} type="button"><Trash2 aria-hidden="true" size={16} /><span>{phrase("删除", "Delete")}</span></button>}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state"><strong>{phrase("这里还没有文章", "No articles yet")}</strong><span>{querySearch ? phrase("换一个关键词试试。", "Try another keyword.") : status === "deleted" ? phrase("回收站目前是空的。", "The recycle bin is empty.") : phrase("点击右上角“写文章”开始创作。", "Use Write article in the upper-right corner to start creating.")}</span></div>}

      {list.items.length ? <ArticleInfiniteFooter hasMore={list.page < list.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
        </div>
      </div>
      {appealArticle ? <div className="modal-backdrop article-appeal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !isAppealSaving) setAppealArticle(null); }}><form className="article-appeal-modal" onSubmit={async (event) => { event.preventDefault(); const token = readAccessToken(); if (!token || !appealReason.trim()) return; setIsAppealSaving(true); try { await createArticleAppeal(token, appealArticle.id, appealReason.trim()); setAppealArticle(null); setNotice(phrase("申诉已提交，等待管理员处理。", "Appeal submitted. Awaiting administrator review.")); } catch (appealError) { setError(appealError instanceof Error ? appealError.message : phrase("申诉提交失败。", "Could not submit the appeal.")); } finally { setIsAppealSaving(false); } }}><header><strong>{phrase("申诉文章", "Appeal article")}</strong><button aria-label={phrase("关闭", "Close")} onClick={() => setAppealArticle(null)} type="button"><X size={17} /></button></header><p>{phrase(`《${appealArticle.title}》当前处于受限状态，修改内容后可以提交申诉。`, `“${appealArticle.title}” is currently restricted. You can submit an appeal after revising it.`)}</p><textarea autoFocus maxLength={1000} onChange={(event) => setAppealReason(event.target.value)} placeholder={phrase("请填写申诉理由和你已做的修改", "Describe your appeal and changes made")} required rows={7} value={appealReason} /><footer><button className="button" disabled={isAppealSaving} type="submit">{isAppealSaving ? phrase("提交中", "Submitting") : phrase("提交申诉", "Submit appeal")}</button></footer></form></div> : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function appendArticlePage(current: ArticleList, next: ArticleList): ArticleList {
  const existingIds = new Set(current.items.map((article) => article.id));
  return { ...next, items: [...current.items, ...next.items.filter((article) => !existingIds.has(article.id))] };
}
