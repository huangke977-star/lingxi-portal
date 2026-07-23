"use client";

import Link from "next/link";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  ExternalLink,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleAuthorLine, ArticlePinBadge, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  ArticleComment,
  ArticleList,
  ARTICLE_STATUS_LABEL,
  ARTICLE_VISIBILITY_LABEL,
  listAdminArticles,
  listAdminComments,
  moderateArticle,
  moderateArticleComment,
} from "@/lib/article-api";
import { buildArticleCommentThreads } from "@/lib/article-comments";
import type { ArticleCommentThread } from "@/lib/article-comments";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

const emptyArticleList: ArticleList = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};

export default function AdminArticlesPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [articleList, setArticleList] = useState<ArticleList>(emptyArticleList);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
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
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const composingRef = useRef(false);
  const initializedRef = useRef(false);

  const commentThreads = useMemo(() => buildArticleCommentThreads(comments), [comments]);

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
      return;
    }
    applyArticleSelection(nextSelected);
    if (activeTab === "comments") await loadComments(token, nextSelected.id);
  }

  useEffect(() => {
    if (composingRef.current) return;
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = "/login?from=%2Fadmin%2Farticles";
      return;
    }
    // Initial route hydration starts the protected article workspace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([getMe(token), loadArticles(token, 1, "")])
      .then(([currentUser]) => {
        if (!currentUser.isSuperAdmin && currentUser.role.level < 90) {
          window.location.href = "/";
          return;
        }
        setUser(currentUser);
        initializedRef.current = true;
      })
      .catch(handleLoadError)
      .finally(() => setIsLoading(false));
    // Authentication and initial content are loaded once for the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      window.location.href = "/";
      return;
    }
    setError(loadError instanceof Error ? loadError.message : "无法加载文章管理。");
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
      setNotice("文章管理设置已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
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
      setNotice(nextStatus === "active" ? "评论内容已恢复。" : nextStatus === "blocked" ? "评论内容已屏蔽。" : "评论内容已删除。");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "评论内容处理失败。");
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

  function renderArticleList() {
    return (
      <aside className="admin-article-list">
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
              <small>{article.author.nickname} · {ARTICLE_STATUS_LABEL[article.status]}</small>
            </span>
            <span className="admin-article-row-meta">
              {article.commentCount ? <span><MessageSquare aria-hidden="true" size={13} />{article.commentCount}</span> : null}
            </span>
          </button>
        ))}
        {!articleList.items.length ? <div className="article-empty-inline">暂时没有文章。</div> : null}
        {articleList.totalPages > 1 ? (
          <nav aria-label="文章分页" className="article-pagination admin-article-pagination">
            <button disabled={articleList.page <= 1} onClick={() => void changeArticlePage(articleList.page - 1)} title="上一页" type="button"><ChevronLeft aria-hidden="true" size={17} /></button>
            <span>{articleList.page} / {articleList.totalPages}</span>
            <button disabled={articleList.page >= articleList.totalPages} onClick={() => void changeArticlePage(articleList.page + 1)} title="下一页" type="button"><ChevronRight aria-hidden="true" size={17} /></button>
          </nav>
        ) : null}
      </aside>
    );
  }

  function renderCommentRow(comment: ArticleComment, parent: ArticleComment | null, replyCount = 0) {
    return (
      <article className={`admin-comment-row ${comment.status}${parent ? " reply" : ""}`} key={comment.id}>
        <div className="admin-comment-row-heading">
          <ArticleAuthorLine author={comment.author} />
          {parent ? <span className="admin-comment-reply-target"><CornerDownRight aria-hidden="true" size={13} />回复 @{parent.author.nickname}</span> : null}
          <span>{formatArticleDate(comment.createdAt)}</span>
          <span className={`article-status-dot ${comment.status}`}>{comment.status === "active" ? "正常" : comment.status === "blocked" ? "已屏蔽" : "已删除"}</span>
          {replyCount ? <span className="admin-comment-thread-count">{replyCount} 条回复</span> : null}
        </div>
        <p>{comment.body}</p>
        <div className="admin-comment-row-actions">
          {comment.status !== "active" ? <button onClick={() => void changeCommentStatus(comment, "active")} type="button"><ShieldCheck aria-hidden="true" size={15} />恢复</button> : <button onClick={() => void changeCommentStatus(comment, "blocked")} type="button"><Flag aria-hidden="true" size={15} />屏蔽</button>}
          <button className="text-danger-action" onClick={() => void changeCommentStatus(comment, "deleted")} type="button"><Trash2 aria-hidden="true" size={15} />删除</button>
        </div>
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
        <div className="admin-content-tabs">
          <button className={activeTab === "articles" ? "active" : undefined} onClick={() => void changeTab("articles")} type="button"><FileText aria-hidden="true" size={16} />文章 <span>{articleList.total}</span></button>
          <button className={activeTab === "comments" ? "active" : undefined} onClick={() => void changeTab("comments")} type="button"><MessageSquare aria-hidden="true" size={16} />评论与回复 <span>{selected?.commentCount ?? 0}</span></button>
        </div>
        <label className="article-search admin-article-search">
          <Search aria-hidden="true" size={16} />
          <input aria-label="搜索管理文章" onChange={(event) => setSearchInput(event.target.value)} onCompositionEnd={(event) => { composingRef.current = false; setSearchInput(event.currentTarget.value); }} onCompositionStart={() => { composingRef.current = true; }} placeholder="搜索标题、作者、分类或正文" value={searchInput} />
          {searchInput ? <button aria-label="清除搜索" onClick={() => setSearchInput("")} title="清除搜索" type="button"><X aria-hidden="true" size={15} /></button> : null}
        </label>
      </div>

      {isLoading ? <div className="article-empty-state">正在读取内容管理。</div> : activeTab === "articles" ? (
        <div className="admin-articles-layout">
          {renderArticleList()}
          <section className="admin-article-inspector">
            {selected ? <>
              <div className="admin-inspector-heading"><div><span className="section-label">Article Inspector</span><h2>{selected.title}</h2></div><span className="admin-article-author">{selected.author.nickname}</span></div>
              <div className="admin-stat-strip"><span><Eye aria-hidden="true" size={15} />{selected.viewCount}<small>阅读</small></span><span><Heart aria-hidden="true" size={15} />{selected.likeCount}<small>点赞</small></span><span><MessageSquare aria-hidden="true" size={15} />{selected.commentCount}<small>评论</small></span><span><Bookmark aria-hidden="true" size={15} />{selected.favoriteCount}<small>收藏</small></span></div>
              <div className="admin-article-controls"><label>文章状态<select onChange={(event) => setStatus(event.target.value as Article["status"])} value={status}>{Object.entries(ARTICLE_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>阅读权限<select onChange={(event) => setVisibility(event.target.value as Article["visibility"])} value={visibility}>{Object.entries(ARTICLE_VISIBILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>标题颜色<input aria-label="标题颜色" onChange={(event) => setTitleColor(event.target.value)} type="color" value={titleColor || "#2b2530"} /></label><label>置顶顺序<input min={0} onChange={(event) => setPinOrder(Number(event.target.value))} type="number" value={pinOrder} /></label></div>
              {visibility === "role_restricted" ? <input className="admin-role-input" onChange={(event) => setRoleCodes(event.target.value)} placeholder="角色代码，用逗号分隔" value={roleCodes} /> : null}
              <label className="admin-pin-check"><input checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} type="checkbox" /><Pin aria-hidden="true" size={16} />置顶文章</label>
              <label className="admin-reason-field">屏蔽说明<textarea maxLength={255} onChange={(event) => setBlockedReason(event.target.value)} placeholder="文章被屏蔽时可以记录原因" rows={3} value={blockedReason} /></label>
              <div className="admin-inspector-footer"><span>更新于 {formatArticleDate(selected.updatedAt)}</span><button className="button" disabled={isSaving} onClick={() => void saveArticleModeration()} type="button"><Save aria-hidden="true" size={16} />{isSaving ? "保存中" : "保存设置"}</button></div>
            </> : <div className="article-empty-state">选择一篇文章查看管理项。</div>}
          </section>
        </div>
      ) : (
        <div className="admin-articles-layout admin-comments-layout">
          {renderArticleList()}
          <section className="admin-comments-panel">
            {selected ? <>
              <div className="admin-comments-heading"><div><span className="section-label">Comment Thread</span><h2>{selected.title}</h2></div><Link href={`/articles/${selected.slug}`} target="_blank"><ExternalLink aria-hidden="true" size={15} />查看文章</Link></div>
              {isCommentsLoading ? <div className="article-empty-state">正在读取评论。</div> : commentThreads.length ? <div className="admin-comments-table">{commentThreads.map(renderCommentThread)}</div> : <div className="article-empty-state">这篇文章暂时没有评论和回复。</div>}
            </> : <div className="article-empty-state">选择一篇文章查看评论。</div>}
          </section>
        </div>
      )}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
