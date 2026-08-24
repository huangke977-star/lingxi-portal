"use client";

import { useSearchParams } from "next/navigation";
import {
  Bookmark,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Eye,
  FileText,
  Flag,
  Heart,
  MessageSquare,
  Pin,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Suspense, type UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { ArticleAuthorLine, ArticlePinBadge, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import {
  Article,
  ArticleAppeal,
  ArticleComment,
  ArticleCommentReport,
  ArticleReport,
  ArticleList,
  ARTICLE_STATUS_LABEL,
  ARTICLE_VISIBILITY_LABEL,
  getAdminArticle,
  getArticleReportSummary,
  getCommentReportSummary,
  listAdminArticles,
  listAdminComments,
  listCommentReports,
  listArticleReports,
  listArticleAppeals,
  moderateArticle,
  moderateArticleComment,
  moderateCommentReport,
  moderateArticleReport,
  moderateArticleAppeal,
} from "@/lib/article-api";
import { buildArticleCommentThreads } from "@/lib/article-comments";
import type { ArticleCommentThread } from "@/lib/article-comments";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";

const emptyArticleList: ArticleList = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};

type InlinePhrase = (chinese: string, english: string) => string;

function articleStatusLabel(status: Article["status"], phrase: InlinePhrase) {
  const labels: Record<Article["status"], [string, string]> = {
    draft: ["草稿", "Draft"],
    published: ["已发布", "Published"],
    unpublished: ["已下架", "Unpublished"],
    blocked: ["受限", "Restricted"],
    deleted: ["回收站", "Recycle bin"],
  };
  const [chinese, english] = labels[status];
  return phrase(chinese, english);
}

function articleVisibilityLabel(visibility: Article["visibility"], phrase: InlinePhrase) {
  const labels: Record<Article["visibility"], [string, string]> = {
    public: ["公开", "Public"],
    authenticated: ["登录可见", "Signed-in users"],
    role_restricted: ["指定角色", "Selected roles"],
    private: ["仅自己", "Only me"],
  };
  const [chinese, english] = labels[visibility];
  return phrase(chinese, english);
}

function reportReasonLabel(reason: ArticleReport["reason"], phrase: InlinePhrase) {
  const labels: Record<ArticleReport["reason"], [string, string]> = {
    spam: ["垃圾信息", "Spam"],
    harassment: ["骚扰辱骂", "Harassment"],
    illegal: ["违法违规", "Illegal content"],
    privacy: ["隐私泄露", "Privacy violation"],
    misinformation: ["不实信息", "Misinformation"],
    other: ["其他", "Other"],
  };
  const [chinese, english] = labels[reason];
  return phrase(chinese, english);
}

export default function AdminArticlesPage() {
  return <Suspense fallback={<AdminArticlesFallback />}><AdminArticlesWorkspace /></Suspense>;
}

function AdminArticlesFallback() {
  const { phrase } = useLanguage();
  return <div className="article-empty-state">{phrase("正在打开文章管理。", "Opening article management.")}</div>;
}

function AdminArticlesWorkspace() {
  const searchParams = useSearchParams();
  const { locale, phrase } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [articleList, setArticleList] = useState<ArticleList>(emptyArticleList);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [reports, setReports] = useState<ArticleCommentReport[]>([]);
  const [articleReports, setArticleReports] = useState<ArticleReport[]>([]);
  const [articleAppeals, setArticleAppeals] = useState<ArticleAppeal[]>([]);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const [commentFilter, setCommentFilter] = useState<"all" | "reported" | "pending">("all");
  const [highlightCommentId, setHighlightCommentId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Article | null>(null);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [activeTab, setActiveTab] = useState<"articles" | "comments">("articles");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState<Article["status"]>("published");
  const [visibility, setVisibility] = useState<Article["visibility"]>("public");
  const [roleCodes, setRoleCodes] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [pinOrder, setPinOrder] = useState(0);
  const [titleColor, setTitleColor] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAppendingArticles, setIsAppendingArticles] = useState(false);
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReportQueueOpen, setIsReportQueueOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reportAction, setReportAction] = useState<{ report: ArticleReport; action: "rejected" | "resolved" | "blocked" | "deleted" } | null>(null);
  const [reportResolution, setReportResolution] = useState("");
  const [appealAction, setAppealAction] = useState<{ appeal: ArticleAppeal; status: "approved" | "rejected" } | null>(null);
  const [appealResolution, setAppealResolution] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const initializedRef = useRef(false);
  const reportQueueRef = useRef<HTMLDivElement | null>(null);
  const reportQueueCloseTimerRef = useRef<number | null>(null);
  const lastLocatedReportKeyRef = useRef("");
  const requestedReportId = Number(searchParams.get("report") ?? 0);
  const requestedReportSource = searchParams.get("reportSource");
  const requestedReportKey = requestedReportId > 0 ? `${requestedReportSource ?? "any"}-${requestedReportId}` : "";
  const requestedTab = searchParams.get("tab");

  const commentThreads = useMemo(() => buildArticleCommentThreads(comments), [comments]);
  const visibleCommentThreads = useMemo(() => commentThreads.filter((thread) => {
    if (commentFilter === "all") return true;
    const threadComments = [thread.root, ...thread.replies.map(({ comment }) => comment)];
    return threadComments.some((comment) => {
      const commentReports = comment.reports ?? [];
      return commentFilter === "reported"
        ? commentReports.length > 0
        : commentReports.some((report) => report.status === "pending");
    });
  }), [commentFilter, commentThreads]);

  function applyArticleSelection(article: Article) {
    setSelected(article);
    setStatus(article.status);
    setVisibility(article.visibility);
    setRoleCodes(article.allowedRoles.map((role) => role.code).join(", "));
    setIsPinned(article.isPinned);
    setPinOrder(article.pinOrder);
    setTitleColor(article.titleColor);
    setBlockedReason(article.blockedReason ?? "");
  }

  async function loadComments(token: string, articleId: number) {
    setIsCommentsLoading(true);
    try {
      const result = await listAdminComments(token, articleId);
      setComments(result.items);
    } finally {
      setIsCommentsLoading(false);
    }
  }

  async function loadReportQueue(token: string) {
    const [summary, reportResult, articleSummary, articleReportResult, appealResult] = await Promise.all([
      getCommentReportSummary(token),
      listCommentReports(token, "pending"),
      getArticleReportSummary(token),
      listArticleReports(token),
      listArticleAppeals(token),
    ]);
    setPendingReportCount(summary.pending + articleSummary.pending);
    setReports(reportResult.items);
    setArticleReports(articleReportResult.items);
    setArticleAppeals(appealResult.items);
    setPendingReportCount(summary.pending + articleSummary.pending + appealResult.items.filter((appeal) => appeal.status === "pending").length);
    return { reportResult, articleReportResult: { items: articleReportResult.items.filter((report) => report.status === "pending") } };
  }

  async function loadArticles(token: string, page: number, search = searchQuery) {
    const result = await listAdminArticles(token, {
      page,
      pageSize: 12,
      search,
      sort: "latest",
    });
    setArticleList(result);
    const nextSelected = result.items.find((article) => article.id === selected?.id)
      ?? result.items[0]
      ?? null;
    if (!nextSelected) {
      setSelected(null);
      setComments([]);
      return result;
    }
    applyArticleSelection(nextSelected);
    if (activeTab === "comments") await loadComments(token, nextSelected.id);
    return result;
  }

  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [isComposing, searchInput]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = `${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/articles", locale))}`;
      return;
    }
    // Initial route hydration starts the protected article workspace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([getMe(token), loadArticles(token, 1, ""), loadReportQueue(token)])
      .then(([currentUser, articleResult, reportQueue]) => {
        if (!isSiteManager(currentUser)) {
          window.location.href = localizedPath("/", locale);
          return;
        }
        setUser(currentUser);
        initializedRef.current = true;
        if (requestedReportId > 0) {
          const requestedReport = requestedReportSource !== "article"
            ? reportQueue.reportResult.items.find((report) => report.id === requestedReportId)
            : undefined;
          const requestedArticleReport = requestedReportSource !== "comment"
            ? reportQueue.articleReportResult.items.find((report) => report.id === requestedReportId)
            : undefined;
          if (requestedReport) {
            lastLocatedReportKeyRef.current = requestedReportKey;
            void locateReportedComment(requestedReport);
            return;
          }
          if (requestedArticleReport) {
            lastLocatedReportKeyRef.current = requestedReportKey;
            void locateArticleReport(requestedArticleReport);
            return;
          }
        }
        if (requestedReportId <= 0 && requestedTab === "comments" && articleResult.items[0]) {
          setActiveTab("comments");
          void loadComments(token, articleResult.items[0].id);
        }
      })
      .catch(handleLoadError)
      .finally(() => setIsLoading(false));
    // Authentication and initial content are loaded once for the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initializedRef.current || requestedReportId <= 0 || lastLocatedReportKeyRef.current === requestedReportKey) return;
    const requestedReport = requestedReportSource !== "article"
      ? reports.find((report) => report.id === requestedReportId)
      : undefined;
    const requestedArticleReport = requestedReportSource !== "comment"
      ? articleReports.find((report) => report.id === requestedReportId)
      : undefined;
    if (!requestedReport && !requestedArticleReport) return;
    lastLocatedReportKeyRef.current = requestedReportKey;
    void (requestedReport ? locateReportedComment(requestedReport) : locateArticleReport(requestedArticleReport!));
    // The report query is an external navigation target and should retrigger when only its id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleReports, reports, requestedReportId, requestedReportKey, requestedReportSource]);

  useEffect(() => {
    if (!isReportQueueOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!reportQueueRef.current?.contains(event.target as Node)) {
        setIsReportQueueOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsReportQueueOpen(false);
    }

    const frame = window.requestAnimationFrame(() => {
      document.addEventListener("pointerdown", handlePointerDown);
    });
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isReportQueueOpen]);

  useEffect(() => () => {
    if (reportQueueCloseTimerRef.current !== null) {
      window.clearTimeout(reportQueueCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    const token = readAccessToken();
    if (!token) return;
    // Search changes start a new asynchronous page request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    loadArticles(token, 1, searchQuery)
      .catch(handleLoadError)
      .finally(() => setIsLoading(false));
    // Search owns the current article page and always resets pagination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  function handleLoadError(loadError: unknown) {
    if (isAuthExpiredError(loadError)) {
      clearAuthTokens();
      window.location.href = localizedPath("/", locale);
      return;
    }
    setError(loadError instanceof Error ? loadError.message : phrase("无法加载文章管理。", "Could not load article management."));
  }

  async function selectArticle(article: Article) {
    applyArticleSelection(article);
    if (activeTab !== "comments") return;
    const token = readAccessToken();
    if (!token) return;
    try {
      await loadComments(token, article.id);
    } catch (loadError) {
      handleLoadError(loadError);
    }
  }

  async function openArticlePreview(articleId: number) {
    const token = readAccessToken();
    if (!token) return;
    try {
      setPreviewArticle(await getAdminArticle(token, articleId));
    } catch (loadError) {
      handleLoadError(loadError);
    }
  }

  async function changeTab(nextTab: "articles" | "comments") {
    setActiveTab(nextTab);
    if (nextTab !== "comments" || !selected) return;
    const token = readAccessToken();
    if (!token) return;
    try {
      await loadComments(token, selected.id);
    } catch (loadError) {
      handleLoadError(loadError);
    }
  }

  async function saveArticleModeration() {
    const token = readAccessToken();
    if (!token || !selected) return;
    setIsSaving(true);
    try {
      const updated = await moderateArticle(token, selected.id, {
        status,
        visibility,
        roleCodes: roleCodes.split(",").map((value) => value.trim()).filter(Boolean),
        isPinned,
        pinOrder,
        titleColor,
        blockedReason,
      });
      setArticleList((current) => ({
        ...current,
        items: current.items.map((article) => article.id === updated.id ? updated : article),
      }));
      applyArticleSelection(updated);
      setNotice(phrase("文章管理设置已保存。", "Article settings saved."));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("保存失败。", "Could not save changes."));
    } finally {
      setIsSaving(false);
    }
  }

  async function changeCommentStatus(
    comment: ArticleComment,
    nextStatus: ArticleComment["status"],
  ) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await moderateArticleComment(token, comment.id, nextStatus);
      setComments((current) => current.map((item) => (
        item.id === comment.id ? { ...item, status: nextStatus } : item
      )));
      setNotice(nextStatus === "active" ? phrase("评论内容已恢复。", "Comment restored.") : nextStatus === "blocked" ? phrase("评论内容已屏蔽。", "Comment blocked.") : phrase("评论内容已删除。", "Comment deleted."));
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : phrase("评论内容处理失败。", "Could not update comment."));
    }
  }

  async function changeArticlePage(page: number) {
    const token = readAccessToken();
    if (!token || page < 1 || page > articleList.totalPages) return;
    setIsLoading(true);
    try {
      await loadArticles(token, page);
    } catch (loadError) {
      handleLoadError(loadError);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMoreArticles() {
    const token = readAccessToken();
    if (!token || isLoading || isAppendingArticles || articleList.page >= articleList.totalPages) return;
    setIsAppendingArticles(true);
    try {
      const result = await listAdminArticles(token, {
        page: articleList.page + 1,
        pageSize: 12,
        search: searchQuery,
        sort: "latest",
      });
      setArticleList((current) => {
        const existingIds = new Set(current.items.map((article) => article.id));
        return {
          ...result,
          items: [
            ...current.items,
            ...result.items.filter((article) => !existingIds.has(article.id)),
          ],
        };
      });
    } catch (loadError) {
      handleLoadError(loadError);
    } finally {
      setIsAppendingArticles(false);
    }
  }

  function handleArticleListScroll(event: UIEvent<HTMLElement>) {
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining > 72) return;
    void loadMoreArticles();
  }

  async function locateReportedComment(report: ArticleCommentReport) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const article = await getAdminArticle(token, report.article.id);
      applyArticleSelection(article);
      setActiveTab("comments");
      setCommentFilter("all");
      await loadComments(token, article.id);
      setHighlightCommentId(report.commentId);
      setIsReportQueueOpen(false);
      window.setTimeout(() => {
        document.getElementById(`admin-comment-${report.commentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
      window.setTimeout(() => setHighlightCommentId(null), 3600);
    } catch (locateError) {
      setError(locateError instanceof Error ? locateError.message : phrase("无法定位被举报的评论。", "Could not locate reported comment."));
    }
  }

  async function locateArticleReport(report: ArticleReport) {
    const token = readAccessToken();
    if (!token) return;
    try {
      const article = await getAdminArticle(token, report.article.id);
      applyArticleSelection(article);
      setActiveTab("articles");
      setIsReportQueueOpen(false);
      setNotice(phrase("已定位到被举报文章。", "Reported article located."));
    } catch (locateError) {
      setError(locateError instanceof Error ? locateError.message : phrase("无法定位被举报的文章。", "Could not locate reported article."));
    }
  }

  function cancelReportQueueClose() {
    if (reportQueueCloseTimerRef.current !== null) {
      window.clearTimeout(reportQueueCloseTimerRef.current);
      reportQueueCloseTimerRef.current = null;
    }
  }

  function openReportQueue() {
    cancelReportQueueClose();
    setIsReportQueueOpen(true);
  }

  function scheduleReportQueueClose() {
    cancelReportQueueClose();
    reportQueueCloseTimerRef.current = window.setTimeout(() => {
      setIsReportQueueOpen(false);
      reportQueueCloseTimerRef.current = null;
    }, 300);
  }

  async function handleReport(
    report: ArticleCommentReport,
    status: "resolved" | "rejected",
    commentStatus?: ArticleComment["status"],
  ) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await moderateCommentReport(token, report.id, { status, commentStatus });
      await loadReportQueue(token);
      if (selected) await loadComments(token, selected.id);
      setNotice(status === "rejected" ? phrase("举报已驳回。", "Report rejected.") : commentStatus === "deleted" ? phrase("评论已删除并处理举报。", "Comment deleted and report resolved.") : phrase("评论已屏蔽并处理举报。", "Comment blocked and report resolved."));
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : phrase("举报处理失败。", "Could not resolve report."));
    }
  }

  function handleArticleReport(
    report: ArticleReport,
    action: "rejected" | "resolved" | "blocked" | "deleted",
  ) {
    setReportResolution("");
    setReportAction({ report, action });
  }

  async function submitArticleReportAction(event: React.FormEvent) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !reportAction || !reportResolution.trim()) return;
    try {
      await moderateArticleReport(token, reportAction.report.id, { status: reportAction.action === "rejected" ? "rejected" : "resolved", articleStatus: reportAction.action === "blocked" || reportAction.action === "deleted" ? reportAction.action : undefined, resolution: reportResolution.trim() });
      const refreshed = await getAdminArticle(token, reportAction.report.article.id);
      applyArticleSelection(refreshed);
      setArticleList((current) => ({ ...current, items: current.items.map((item) => item.id === refreshed.id ? refreshed : item) }));
      await loadReportQueue(token);
      setReportAction(null);
      setNotice(reportAction.action === "rejected" ? phrase("文章举报已驳回。", "Article report rejected.") : reportAction.action === "resolved" ? phrase("举报已处理，文章未修改。", "Report resolved and article kept.") : reportAction.action === "blocked" ? phrase("文章已屏蔽并处理举报。", "Article blocked and report resolved.") : phrase("文章已删除并处理举报。", "Article deleted and report resolved."));
    } catch (reportError) { setError(reportError instanceof Error ? reportError.message : phrase("文章举报处理失败。", "Could not resolve article report.")); }
  }

  function handleArticleAppeal(appeal: ArticleAppeal, status: "approved" | "rejected") {
    setAppealResolution("");
    setAppealAction({ appeal, status });
  }

  async function submitArticleAppealAction(event: React.FormEvent) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !appealAction || !appealResolution.trim()) return;
    try {
      await moderateArticleAppeal(token, appealAction.appeal.id, { status: appealAction.status, resolution: appealResolution.trim() });
      await loadReportQueue(token);
      setAppealAction(null);
      setNotice(appealAction.status === "approved" ? phrase("申诉已通过，文章已解除屏蔽。", "Appeal approved and article unblocked.") : phrase("申诉已驳回。", "Appeal rejected."));
    } catch (appealError) { setError(appealError instanceof Error ? appealError.message : phrase("申诉处理失败。", "Could not resolve appeal.")); }
  }

  function renderArticleReports(articleId: number) {
    const reportsForArticle = articleReports.filter((report) => report.article.id === articleId);
    if (!reportsForArticle.length) return null;
    return <section className="admin-article-reports"><div className="admin-section-heading"><span><AlertTriangle aria-hidden="true" size={15} />{phrase("文章举报", "Article reports")}</span><small>{phrase(`${reportsForArticle.length} 条`, `${reportsForArticle.length} reports`)}</small></div>{reportsForArticle.map((report) => <article className={`admin-article-report ${report.status}`} key={report.id}><div><strong>{reportReasonLabel(report.reason, phrase)}</strong><span>{report.reporter.nickname} · {formatArticleDate(report.createdAt, locale)}</span></div>{report.detail ? <p>{report.detail}</p> : null}{report.status === "pending" ? <div className="admin-article-report-actions"><button onClick={() => handleArticleReport(report, "rejected")} type="button">{phrase("驳回", "Reject")}</button><button onClick={() => handleArticleReport(report, "resolved")} type="button">{phrase("处理但不改文章", "Resolve and keep article")}</button><button onClick={() => handleArticleReport(report, "blocked")} type="button">{phrase("屏蔽文章", "Block article")}</button><button className="text-danger-action" onClick={() => handleArticleReport(report, "deleted")} type="button">{phrase("删除文章", "Delete article")}</button></div> : <em>{report.status === "resolved" ? phrase("已处理", "Resolved") : phrase("已驳回", "Rejected")}{report.resolution ? ` · ${report.resolution}` : ""}</em>}</article>)}</section>;
  }

  function renderArticleAppeals(articleId: number) {
    const appeals = articleAppeals.filter((appeal) => appeal.article.id === articleId);
    if (!appeals.length) return null;
    return <section className="admin-article-appeals"><div className="admin-section-heading"><span><ShieldCheck aria-hidden="true" size={15} />{phrase("文章申诉", "Article appeals")}</span><small>{phrase(`${appeals.length} 条`, `${appeals.length} appeals`)}</small></div>{appeals.map((appeal) => <article className={`admin-article-appeal ${appeal.status}`} key={appeal.id}><div><strong>{appeal.author.nickname}</strong><span>{formatArticleDate(appeal.createdAt, locale)}</span></div><p>{appeal.reason}</p>{appeal.status === "pending" ? <div className="admin-article-report-actions"><button onClick={() => handleArticleAppeal(appeal, "rejected")} type="button">{phrase("驳回", "Reject")}</button><button onClick={() => handleArticleAppeal(appeal, "approved")} type="button">{phrase("通过申诉", "Approve appeal")}</button></div> : <em>{appeal.status === "approved" ? phrase("已通过", "Approved") : phrase("已驳回", "Rejected")}{appeal.resolution ? ` · ${appeal.resolution}` : ""}</em>}</article>)}</section>;
  }

  function renderArticleList() {
    return (
      <aside className="admin-article-list" onScroll={handleArticleListScroll}>
        {articleList.items.map((article) => (
          <button
            className={`admin-article-row${selected?.id === article.id ? " active" : ""}`}
            key={article.id}
            onClick={() => void selectArticle(article)}
            type="button"
          >
            <ArticlePinBadge isPinned={article.isPinned} />
            <span>
              <strong>{article.title}</strong>
              <small>{article.author.nickname} · {articleStatusLabel(article.status, phrase)}</small>
            </span>
            <span className="admin-article-row-meta">
              {article.commentCount ? <span><MessageSquare aria-hidden="true" size={13} />{article.commentCount}</span> : null}
            </span>
          </button>
        ))}
        {!articleList.items.length ? <div className="article-empty-inline">{phrase("暂时没有文章。", "No articles yet.")}</div> : null}
        {articleList.totalPages > 1 ? <div className="admin-article-list-footer">{isAppendingArticles ? phrase("正在加载更多", "Loading more") : articleList.page < articleList.totalPages ? phrase("继续下滑加载更多", "Scroll down to load more") : phrase("已经到底了", "No more articles")}</div> : null}
        {articleList.totalPages > 1 ? (
          <nav aria-label={phrase("文章分页", "Article pagination")} className="article-pagination admin-article-pagination">
            <button disabled={articleList.page <= 1} onClick={() => void changeArticlePage(articleList.page - 1)} title={phrase("上一页", "Previous")} type="button"><ChevronLeft aria-hidden="true" size={17} /></button>
            <span>{articleList.page} / {articleList.totalPages}</span>
            <button disabled={articleList.page >= articleList.totalPages} onClick={() => void changeArticlePage(articleList.page + 1)} title={phrase("下一页", "Next")} type="button"><ChevronRight aria-hidden="true" size={17} /></button>
          </nav>
        ) : null}
      </aside>
    );
  }

  function renderCommentRow(comment: ArticleComment, parent: ArticleComment | null, replyCount = 0) {
    return (
      <article className={`admin-comment-row ${comment.status}${parent ? " reply" : ""}${highlightCommentId === comment.id ? " highlighted" : ""}`} id={`admin-comment-${comment.id}`} key={comment.id}>
        <div className="admin-comment-row-heading">
          <ArticleAuthorLine author={comment.author} />
          {parent ? <span className="admin-comment-reply-target"><CornerDownRight aria-hidden="true" size={13} />{phrase(`回复 @${parent.author.nickname}`, `Reply to @${parent.author.nickname}`)}</span> : null}
          <span>{formatArticleDate(comment.createdAt, locale)}</span>
          <span className={`article-status-dot ${comment.status}`}>{comment.status === "active" ? phrase("正常", "Active") : comment.status === "blocked" ? phrase("已屏蔽", "Blocked") : phrase("已删除", "Deleted")}</span>
          {replyCount ? <span className="admin-comment-thread-count">{phrase(`${replyCount} 条回复`, `${replyCount} replies`)}</span> : null}
          {comment.pendingReportCount ? <span className="admin-comment-report-badge"><AlertTriangle aria-hidden="true" size={13} />{phrase(`${comment.pendingReportCount} 条待处理`, `${comment.pendingReportCount} pending`)}</span> : null}
        </div>
        <p>{comment.body}</p>
        <div className="admin-comment-row-actions">
          {comment.status !== "active" ? <button onClick={() => void changeCommentStatus(comment, "active")} type="button"><ShieldCheck aria-hidden="true" size={15} />{phrase("恢复", "Restore")}</button> : <button onClick={() => void changeCommentStatus(comment, "blocked")} type="button"><Flag aria-hidden="true" size={15} />{phrase("屏蔽", "Block")}</button>}
          <button className="text-danger-action" onClick={() => void changeCommentStatus(comment, "deleted")} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("删除", "Delete")}</button>
        </div>
        {comment.reports?.length ? <div className="admin-comment-reports">{comment.reports.map((report) => <div className={`admin-comment-report ${report.status}`} key={report.id}><span><ArticleAuthorLine author={report.reporter} /><strong>{reportReasonLabel(report.reason, phrase)}</strong>{report.detail ? <small>{report.detail}</small> : null}</span>{report.status === "pending" ? <div><button onClick={() => void handleReport(report, "resolved", "blocked")} type="button">{phrase("屏蔽并处理", "Block and resolve")}</button><button onClick={() => void handleReport(report, "resolved", "deleted")} type="button">{phrase("删除并处理", "Delete and resolve")}</button><button onClick={() => void handleReport(report, "rejected")} type="button">{phrase("驳回", "Reject")}</button></div> : <em>{report.status === "resolved" ? phrase("已处理", "Resolved") : phrase("已驳回", "Rejected")}</em>}</div>)}</div> : null}
      </article>
    );
  }

  function renderCommentThread(thread: ArticleCommentThread) {
    return (
      <section className="admin-comment-thread" key={thread.root.id}>
        {renderCommentRow(thread.root, null, thread.replies.length)}
        {thread.replies.length ? <div className="admin-comment-children">{thread.replies.map(({ comment, parent }) => renderCommentRow(comment, parent ?? thread.root))}</div> : null}
      </section>
    );
  }

  return (
    <section className="page-shell admin-articles-page">
      <ArticleCenterNav active="manage" isLoggedIn user={user} />
      <div className="admin-management-toolbar">
        <div className="admin-content-tabs article-center-secondary-tabs">
          <button className={activeTab === "articles" ? "active" : undefined} onClick={() => void changeTab("articles")} type="button"><FileText aria-hidden="true" size={16} />{phrase("文章", "Articles")} <span>{articleList.total}</span></button>
          <button className={activeTab === "comments" ? "active" : undefined} onClick={() => void changeTab("comments")} type="button"><MessageSquare aria-hidden="true" size={16} />{phrase("评论与回复", "Comments and replies")} <span>{selected?.commentCount ?? 0}</span></button>
        </div>
        <div
          className={`admin-report-queue${isReportQueueOpen ? " open" : ""}`}
          onPointerEnter={(event) => { if (event.pointerType === "mouse") openReportQueue(); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleReportQueueClose(); }}
          ref={reportQueueRef}
        >
          <button
            aria-expanded={isReportQueueOpen}
            aria-haspopup="dialog"
            className="admin-report-trigger"
            onClick={() => setIsReportQueueOpen((current) => !current)}
            onFocus={openReportQueue}
            type="button"
          >
            <AlertTriangle aria-hidden="true" size={15} />{phrase("待处理举报", "Pending reports")} <span>{pendingReportCount}</span>
          </button>
          <div className="admin-report-popover" onFocus={cancelReportQueueClose}>
            {reports.length || articleReports.filter((report) => report.status === "pending").length ? <>{articleReports.filter((report) => report.status === "pending").map((report) => <button key={`article-${report.id}`} onClick={() => void locateArticleReport(report)} type="button"><strong>{phrase(`文章举报 · ${report.article.title}`, `Article report · ${report.article.title}`)}</strong><span>{report.reporter.nickname} · {formatArticleDate(report.createdAt, locale)}</span></button>)}{reports.map((report) => <button key={`comment-${report.id}`} onClick={() => void locateReportedComment(report)} type="button"><strong>{phrase(`评论举报 · ${report.article.title}`, `Comment report · ${report.article.title}`)}</strong><span>{report.reporter.nickname} · {formatArticleDate(report.createdAt, locale)}</span></button>)}</> : <span>{phrase("暂无待处理举报。", "No pending reports.")}</span>}
          </div>
        </div>
        <label className="article-search admin-article-search">
          <Search aria-hidden="true" size={16} />
          <input aria-label={phrase("搜索管理文章", "Search managed articles")} onChange={(event) => setSearchInput(event.target.value)} onCompositionEnd={(event) => { setSearchInput(event.currentTarget.value); setIsComposing(false); }} onCompositionStart={() => setIsComposing(true)} placeholder={phrase("搜索标题、作者、分类或正文", "Search title, author, category, or content")} value={searchInput} />
          {searchInput ? <button aria-label={phrase("清除搜索", "Clear search")} onClick={() => setSearchInput("")} title={phrase("清除搜索", "Clear search")} type="button"><X aria-hidden="true" size={15} /></button> : null}
        </label>
      </div>

      {isLoading ? <div className="article-empty-state">{phrase("正在读取内容管理。", "Loading content management.")}</div> : activeTab === "articles" ? (
        <div className="admin-articles-layout">
          {renderArticleList()}
          <section className="admin-article-inspector">
            {selected ? <>
              <div className="admin-inspector-heading"><div><span className="section-label">ARTICLE INSPECTOR</span><h2><button className="admin-article-preview-trigger" onClick={() => void openArticlePreview(selected.id)} title={phrase("查看文章内容", "View article content")} type="button">{selected.title}</button></h2></div><span className="admin-article-author">{selected.author.nickname}</span></div>
              <div className="admin-stat-strip"><span><Eye aria-hidden="true" size={15} />{selected.viewCount}<small>{phrase("阅读", "Views")}</small></span><span><Heart aria-hidden="true" size={15} />{selected.likeCount}<small>{phrase("点赞", "Likes")}</small></span><span><MessageSquare aria-hidden="true" size={15} />{selected.commentCount}<small>{phrase("评论", "Comments")}</small></span><span><Bookmark aria-hidden="true" size={15} />{selected.favoriteCount}<small>{phrase("收藏", "Favorites")}</small></span></div>
              <div className="admin-article-controls"><label>{phrase("文章状态", "Article status")}<GlassSelect ariaLabel={phrase("文章状态", "Article status")} onChange={(value) => setStatus(value as Article["status"])} options={Object.keys(ARTICLE_STATUS_LABEL).map((value) => ({ value, label: articleStatusLabel(value as Article["status"], phrase) }))} value={status} /></label><label>{phrase("阅读权限", "Reading access")}<GlassSelect ariaLabel={phrase("阅读权限", "Reading access")} onChange={(value) => setVisibility(value as Article["visibility"])} options={Object.keys(ARTICLE_VISIBILITY_LABEL).map((value) => ({ value, label: articleVisibilityLabel(value as Article["visibility"], phrase) }))} value={visibility} /></label><label>{phrase("标题颜色", "Title color")}<input aria-label={phrase("标题颜色", "Title color")} onChange={(event) => setTitleColor(event.target.value)} type="color" value={titleColor || "#2b2530"} /></label><label>{phrase("置顶顺序", "Pin order")}<input min={0} onChange={(event) => setPinOrder(Number(event.target.value))} type="number" value={pinOrder} /></label></div>
              {visibility === "role_restricted" ? <input className="admin-role-input" onChange={(event) => setRoleCodes(event.target.value)} placeholder={phrase("角色代码，用逗号分隔", "Role codes, separated by commas")} value={roleCodes} /> : null}
              <label className="admin-pin-check"><input checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} type="checkbox" /><Pin aria-hidden="true" size={16} />{phrase("置顶文章", "Pin article")}</label>
               <label className="admin-reason-field">{phrase("屏蔽说明", "Block reason")}<textarea maxLength={255} onChange={(event) => setBlockedReason(event.target.value)} placeholder={phrase("文章被屏蔽时可以记录原因", "Record why this article is blocked")} rows={3} value={blockedReason} /></label>
               {renderArticleReports(selected.id)}
               {renderArticleAppeals(selected.id)}
               <div className="admin-inspector-footer"><span>{phrase(`更新于 ${formatArticleDate(selected.updatedAt, locale)}`, `Updated ${formatArticleDate(selected.updatedAt, locale)}`)}</span><button className="button" disabled={isSaving} onClick={() => void saveArticleModeration()} type="button"><Save aria-hidden="true" size={16} />{isSaving ? phrase("保存中", "Saving") : phrase("保存设置", "Save settings")}</button></div>
            </> : <div className="article-empty-state">{phrase("选择一篇文章查看管理项。", "Select an article to manage.")}</div>}
          </section>
        </div>
      ) : (
        <div className="admin-articles-layout admin-comments-layout">
          {renderArticleList()}
          <section className="admin-comments-panel">
            {selected ? <>
              <div className="admin-comments-heading"><div><span className="section-label">COMMENT THREAD</span><h2><button className="admin-article-preview-trigger" onClick={() => void openArticlePreview(selected.id)} title={phrase("查看文章内容", "View article content")} type="button">{selected.title}</button></h2></div></div>
              <div className="admin-comment-filters"><button className={commentFilter === "all" ? "active" : undefined} onClick={() => setCommentFilter("all")} type="button">{phrase("全部", "All")}</button><button className={commentFilter === "reported" ? "active" : undefined} onClick={() => setCommentFilter("reported")} type="button">{phrase("有举报", "Reported")}</button><button className={commentFilter === "pending" ? "active" : undefined} onClick={() => setCommentFilter("pending")} type="button">{phrase("待处理", "Pending")}</button></div>
              {isCommentsLoading ? <div className="article-empty-state">{phrase("正在读取评论。", "Loading comments.")}</div> : visibleCommentThreads.length ? <div className="admin-comments-table">{visibleCommentThreads.map(renderCommentThread)}</div> : <div className="article-empty-state">{phrase("当前筛选下没有评论和回复。", "No comments or replies match this filter.")}</div>}
            </> : <div className="article-empty-state">{phrase("选择一篇文章查看评论。", "Select an article to view comments.")}</div>}
          </section>
        </div>
      )}
      {reportAction ? <div className="modal-backdrop article-report-resolution-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setReportAction(null); }}><form className="article-report-resolution-modal" onSubmit={submitArticleReportAction}><header><strong>{phrase("填写处理反馈", "Write resolution feedback")}</strong><button aria-label={phrase("关闭", "Close")} onClick={() => setReportAction(null)} type="button"><X size={17} /></button></header><p>{reportAction.action === "rejected" ? phrase("驳回举报", "Reject report") : reportAction.action === "resolved" ? phrase("处理但不修改文章", "Resolve and keep article") : reportAction.action === "blocked" ? phrase("屏蔽文章", "Block article") : phrase("删除文章", "Delete article")}</p><textarea autoFocus maxLength={500} onChange={(event) => setReportResolution(event.target.value)} placeholder={phrase("反馈内容会发送给举报者和文章作者", "Feedback will be sent to the reporter and article author")} required rows={5} value={reportResolution} /><footer><button className="button" type="submit">{phrase("提交处理", "Submit resolution")}</button></footer></form></div> : null}
      {appealAction ? <div className="modal-backdrop article-report-resolution-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setAppealAction(null); }}><form className="article-report-resolution-modal" onSubmit={submitArticleAppealAction}><header><strong>{appealAction.status === "approved" ? phrase("通过文章申诉", "Approve article appeal") : phrase("驳回文章申诉", "Reject article appeal")}</strong><button aria-label={phrase("关闭", "Close")} onClick={() => setAppealAction(null)} type="button"><X size={17} /></button></header><textarea autoFocus maxLength={500} onChange={(event) => setAppealResolution(event.target.value)} placeholder={phrase("填写处理反馈", "Write resolution feedback")} required rows={5} value={appealResolution} /><footer><button className="button" type="submit">{phrase("提交处理", "Submit resolution")}</button></footer></form></div> : null}
      {previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
