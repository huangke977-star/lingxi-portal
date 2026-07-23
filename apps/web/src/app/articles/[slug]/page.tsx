"use client";

import Link from "next/link";
import { Bookmark, CalendarDays, CornerDownRight, Flag, Heart, MessageCircle, Reply, Send, Tag, ThumbsUp, Trash2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleAuthorLine, ArticleBody, ArticleStats, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { CommentAuthorIdentity } from "@/components/public-profile-popover";
import {
  Article,
  ArticleComment,
  ArticleCommentReportReason,
  createArticleComment,
  deleteArticleComment,
  favoriteArticle,
  getPublicArticle,
  getVisibleArticle,
  likeArticle,
  likeArticleComment,
  listArticleComments,
  reportArticleComment,
} from "@/lib/article-api";
import { buildArticleCommentThreads } from "@/lib/article-comments";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function ArticleDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ArticleComment | null>(null);
  const [reportingComment, setReportingComment] = useState<ArticleComment | null>(null);
  const [reportReason, setReportReason] = useState<ArticleCommentReportReason>("spam");
  const [reportDetail, setReportDetail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const commentThreads = useMemo(() => buildArticleCommentThreads(comments), [comments]);

  useEffect(() => {
    const slug = params.slug;
    if (!slug) return;
    const token = readAccessToken();
    // Authentication is stored outside React and must be synchronized after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoggedIn(Boolean(token));
    Promise.all([
      token ? getMe(token) : Promise.resolve(null),
      token ? getVisibleArticle(token, slug) : getPublicArticle(slug),
      listArticleComments(slug, token ?? undefined),
    ])
      .then(([currentUser, loadedArticle, loadedComments]) => {
        setUser(currentUser);
        setArticle(loadedArticle);
        setComments(loadedComments.items);
      })
      .catch(async (loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          try {
            const loadedArticle = await getPublicArticle(slug);
            setUser(null);
            setIsLoggedIn(false);
            setArticle(loadedArticle);
            setComments((await listArticleComments(slug)).items);
            return;
          } catch (fallbackError) {
            setError(fallbackError instanceof Error ? fallbackError.message : "文章加载失败。");
            return;
          }
        }
        setError(loadError instanceof Error ? loadError.message : "文章加载失败。");
      })
      .finally(() => setIsLoading(false));
  }, [params.slug]);

  async function handleInteraction(kind: "like" | "favorite") {
    if (!article) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    try {
      const result = kind === "like"
        ? await likeArticle(token, article.id, !article.liked)
        : await favoriteArticle(token, article.id, !article.favorited);
      setArticle({
        ...article,
        liked: kind === "like" ? Boolean(result.liked) : article.liked,
        favorited: kind === "favorite" ? Boolean(result.favorited) : article.favorited,
        likeCount: result.likeCount,
        favoriteCount: result.favoriteCount,
      });
    } catch (interactionError) {
      setError(interactionError instanceof Error ? interactionError.message : "操作失败。");
    }
  }

  async function handleCommentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!article || !commentDraft.trim()) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    setIsSubmittingComment(true);
    try {
      const comment = await createArticleComment(token, article.id, commentDraft.trim(), replyingTo?.id);
      setComments((current) => [...current, comment]);
      setArticle((current) => current ? { ...current, commentCount: current.commentCount + 1 } : current);
      setCommentDraft("");
      setReplyingTo(null);
      setNotice(replyingTo ? "回复已发布。" : "评论已发布。");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "评论发布失败。");
    } finally {
      setIsSubmittingComment(false);
    }
  }

  function beginReply(comment: ArticleComment) {
    if (!article) return;
    if (!readAccessToken()) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    setReplyingTo(comment);
    window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      composerRef.current?.focus({ preventScroll: true });
    });
  }

  async function handleCommentDelete(comment: ArticleComment) {
    const token = readAccessToken();
    if (!token || !article || !window.confirm("确定删除这条评论吗？")) return;
    try {
      await deleteArticleComment(token, comment.id);
      const refreshed = await listArticleComments(article.slug, token);
      setComments(refreshed.items);
      setArticle((current) => current ? { ...current, commentCount: Math.max(0, current.commentCount - 1) } : current);
      if (replyingTo?.id === comment.id) setReplyingTo(null);
      setNotice("评论已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "评论删除失败。");
    }
  }

  async function handleCommentLike(comment: ArticleComment) {
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article?.slug ?? ""}`)}`);
      return;
    }
    try {
      const result = await likeArticleComment(token, comment.id, !comment.liked);
      setComments((current) => current.map((item) => item.id === comment.id ? { ...item, ...result } : item));
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : "点赞失败。");
    }
  }

  async function handleReportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !reportingComment) return;
    setIsSubmittingReport(true);
    try {
      await reportArticleComment(token, reportingComment.id, { reason: reportReason, detail: reportDetail.trim() || undefined });
      setComments((current) => current.map((item) => item.id === reportingComment.id ? { ...item, reported: true } : item));
      setReportingComment(null);
      setReportDetail("");
      setNotice("举报已提交，管理员会尽快处理。");
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "举报提交失败。");
    } finally {
      setIsSubmittingReport(false);
    }
  }

  function renderComment(comment: ArticleComment, parent: ArticleComment | null = null) {
    return (
      <div className={parent ? "article-comment-wrap reply" : "article-comment-wrap"} key={comment.id}>
        <article className={`${parent ? "article-comment reply" : "article-comment"}${comment.status !== "active" ? " unavailable" : ""}`}>
          <div className="article-comment-heading">
            <CommentAuthorIdentity author={comment.author} />
            {parent ? <span className="article-reply-target"><CornerDownRight aria-hidden="true" size={13} />回复 @{parent.author.nickname}</span> : null}
            <time>{formatArticleDate(comment.createdAt)}</time>
          </div>
          <p>{comment.body}</p>
          {comment.status === "active" ? <div className="article-comment-actions">
            <button className={comment.liked ? "active" : undefined} onClick={() => void handleCommentLike(comment)} type="button"><ThumbsUp aria-hidden="true" fill={comment.liked ? "currentColor" : "none"} size={14} />{comment.likeCount || "点赞"}</button>
            <button onClick={() => beginReply(comment)} type="button"><Reply aria-hidden="true" size={14} />回复</button>
            {user?.id !== comment.author.id ? <button className={comment.reported ? "active" : undefined} disabled={comment.reported} onClick={() => setReportingComment(comment)} type="button"><Flag aria-hidden="true" size={14} />{comment.reported ? "已举报" : "举报"}</button> : null}
            {user?.id === comment.author.id ? <button className="text-danger-action" onClick={() => void handleCommentDelete(comment)} type="button"><Trash2 aria-hidden="true" size={14} />删除</button> : null}
          </div> : null}
        </article>
      </div>
    );
  }

  if (isLoading) return <section className="page-shell article-detail-page"><div className="article-empty-state">正在读取文章。</div></section>;
  if (!article) return <section className="page-shell article-detail-page"><div className="article-empty-state"><strong>文章暂时无法打开</strong><span>{error || "文章不存在或没有阅读权限。"}</span><Link className="text-action" href="/articles">返回文章列表</Link></div></section>;

  return (
    <section className="page-shell article-detail-page">
      <ArticleCenterNav active="discover" isLoggedIn={isLoggedIn} user={user} />
      <Link className="article-back-link" href="/articles">返回文章</Link>
      <article className="article-reading-layout">
        <header className="article-reading-header">
          <h1 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h1>
          <div className="article-reading-author"><ArticleAuthorLine author={article.author} /><span className="article-reading-divider" /><span>发布于 {formatArticleDate(article.publishedAt)}</span></div>
        </header>
        <div className="article-reading-grid">
          <aside className="article-reading-aside">
            <div className="article-aside-author"><ArticleAuthorLine author={article.author} /><span>@{article.author.username}</span></div>
            <div className="article-reading-actions">
              <button className={article.liked ? "active" : undefined} onClick={() => void handleInteraction("like")} type="button"><Heart aria-hidden="true" size={17} />{article.liked ? "已赞" : "点赞"}</button>
              <button className={article.favorited ? "active" : undefined} onClick={() => void handleInteraction("favorite")} type="button"><Bookmark aria-hidden="true" size={17} />{article.favorited ? "已收藏" : "收藏"}</button>
            </div>
            <ArticleStats article={article} />
            <dl className="article-aside-meta">
              <div><dt><Tag aria-hidden="true" size={15} />分类</dt><dd>{article.category || "随笔"}</dd></div>
              <div><dt><CalendarDays aria-hidden="true" size={15} />发布时间</dt><dd>{formatArticleDate(article.publishedAt)}</dd></div>
              <div><dt>更新时间</dt><dd>{formatArticleDate(article.updatedAt)}</dd></div>
            </dl>
            {article.tags.length ? <div className="article-tag-list">{article.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
          </aside>
          <main className="article-reading-main"><ArticleBody content={article.content} /></main>
        </div>
      </article>

      <section className="article-comments-section">
        <div className="article-section-heading"><div><span className="section-label">Conversation</span><h2>评论与回复</h2></div><span>{article.commentCount} 条</span></div>
        {commentThreads.length ? <div className="article-comments-list">{commentThreads.map((thread) => <section className="article-comment-thread" key={thread.root.id}>{renderComment(thread.root)}{thread.replies.length ? <div className="article-comment-replies">{thread.replies.map(({ comment, parent }) => renderComment(comment, parent ?? thread.root))}</div> : null}</section>)}</div> : <div className="article-empty-inline"><MessageCircle aria-hidden="true" size={18} />还没有评论。</div>}
        <form className="article-comment-form" onSubmit={handleCommentSubmit}>
          {replyingTo ? <div className="article-composer-context"><span>回复 <strong>@{replyingTo.author.nickname}</strong></span><button aria-label="取消回复" onClick={() => setReplyingTo(null)} title="取消回复" type="button"><X aria-hidden="true" size={15} /></button></div> : null}
          <textarea aria-label={replyingTo ? `回复 ${replyingTo.author.nickname}` : "评论文章"} maxLength={2000} onChange={(event) => setCommentDraft(event.target.value)} placeholder={replyingTo ? `回复 @${replyingTo.author.nickname}` : "写下你的想法"} ref={composerRef} rows={3} value={commentDraft} />
          <div className="article-composer-footer"><span>{commentDraft.length} / 2000</span><button className="button" disabled={isSubmittingComment || !commentDraft.trim()} type="submit"><Send aria-hidden="true" size={16} />{isSubmittingComment ? "发布中" : replyingTo ? "发布回复" : "发布评论"}</button></div>
        </form>
      </section>
      {reportingComment ? <div className="comment-report-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setReportingComment(null); }}><form className="comment-report-dialog" onSubmit={handleReportSubmit}><div><strong>举报评论</strong><button aria-label="关闭举报窗口" onClick={() => setReportingComment(null)} type="button"><X aria-hidden="true" size={17} /></button></div><label>举报原因<select onChange={(event) => setReportReason(event.target.value as ArticleCommentReportReason)} value={reportReason}><option value="spam">垃圾广告</option><option value="harassment">辱骂骚扰</option><option value="illegal">违法违规</option><option value="privacy">隐私泄露</option><option value="misinformation">不实内容</option><option value="other">其他</option></select></label><label>补充说明<textarea maxLength={500} onChange={(event) => setReportDetail(event.target.value)} placeholder="可选，帮助管理员判断具体问题" rows={3} value={reportDetail} /></label><button className="button" disabled={isSubmittingReport} type="submit">{isSubmittingReport ? "提交中" : "提交举报"}</button></form></div> : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
