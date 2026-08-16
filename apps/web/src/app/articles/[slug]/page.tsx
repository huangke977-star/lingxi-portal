"use client";

import Link from "next/link";
import { Bookmark, CalendarDays, Clock3, Coins, CornerDownRight, Flag, Heart, LockKeyhole, MessageCircle, Reply, Rss, Send, Tag, ThumbsUp, Trash2, X } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleAuthorLine, ArticleBody, ArticleStats, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { LikeBurst } from "@/components/like-burst";
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
  redeemArticleResource,
  setArticleReadLater,
  updateArticleReadingProgress,
} from "@/lib/article-api";
import { buildArticleCommentThreads } from "@/lib/article-comments";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";
import { getPublicProfile, PublicProfile, subscribeToAuthor, unsubscribeFromAuthor } from "@/lib/social-api";
import { notifySocialStateChange } from "@/lib/social-events";

const COMMENT_PAGE_SIZE = 10;

export default function ArticleDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentNextCursor, setCommentNextCursor] = useState<number | null>(null);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [isLoadingMoreComments, setIsLoadingMoreComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ArticleComment | null>(null);
  const [reportingComment, setReportingComment] = useState<ArticleComment | null>(null);
  const [reportReason, setReportReason] = useState<ArticleCommentReportReason>("spam");
  const [reportDetail, setReportDetail] = useState("");
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isRedeemingResource, setIsRedeemingResource] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [articleLikeBurst, setArticleLikeBurst] = useState(0);
  const [articleFavoriteBurst, setArticleFavoriteBurst] = useState(0);
  const [subscriptionBurst, setSubscriptionBurst] = useState(0);
  const [commentLikeBursts, setCommentLikeBursts] = useState<Record<number, number>>({});
  const [highlightCommentId, setHighlightCommentId] = useState<number | null>(null);
  const [authorProfile, setAuthorProfile] = useState<PublicProfile | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const readingContentRef = useRef<HTMLElement | null>(null);
  const restoredReadingPositionRef = useRef(false);
  const requestedCommentLoadRef = useRef(0);
  const commentThreads = useMemo(() => buildArticleCommentThreads(comments), [comments]);
  const requestedCommentId = Number(searchParams.get("commentId") ?? 0);
  const readingArticleId = article?.id;
  const initialReadingProgress = article?.readingProgress;

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
      listArticleComments(slug, token ?? undefined, { pageSize: COMMENT_PAGE_SIZE, focusId: requestedCommentId || undefined }),
      getPublicSiteSettings().catch(() => null),
    ])
      .then(([currentUser, loadedArticle, loadedComments, loadedSettings]) => {
        setUser(currentUser);
        setArticle(loadedArticle);
        setComments(loadedComments.items);
        setCommentNextCursor(loadedComments.nextCursor);
        setHasMoreComments(loadedComments.hasMore);
        setSiteSettings(loadedSettings);
        if (token && currentUser && currentUser.id !== loadedArticle.author.id) {
          void getPublicProfile(token, loadedArticle.author.id).then(setAuthorProfile).catch(() => undefined);
        }
      })
      .catch(async (loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          try {
            const loadedArticle = await getPublicArticle(slug);
            setUser(null);
            setIsLoggedIn(false);
            setArticle(loadedArticle);
            const loadedComments = await listArticleComments(slug, undefined, { pageSize: COMMENT_PAGE_SIZE, focusId: requestedCommentId || undefined });
            setComments(loadedComments.items);
            setCommentNextCursor(loadedComments.nextCursor);
            setHasMoreComments(loadedComments.hasMore);
            return;
          } catch (fallbackError) {
            setError(fallbackError instanceof Error ? fallbackError.message : "文章加载失败。");
            return;
          }
        }
        setError(loadError instanceof Error ? loadError.message : "文章加载失败。");
      })
      .finally(() => setIsLoading(false));
  }, [params.slug, requestedCommentId]);

  useEffect(() => {
    if (!readingArticleId || !isLoggedIn || !article?.resource.accessible || !readingContentRef.current) return;
    const token = readAccessToken();
    if (!token) return;
    let timer: number | null = null;
    let lastSent = initialReadingProgress ?? 1;
    const sendProgress = () => {
      const element = readingContentRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const top = window.scrollY + rect.top;
      const height = Math.max(1, element.offsetHeight);
      const readingPoint = window.scrollY + window.innerHeight * 0.68;
      const progress = Math.max(1, Math.min(100, Math.round(((readingPoint - top) / height) * 100)));
      if (Math.abs(progress - lastSent) < 2) return;
      lastSent = progress;
      void updateArticleReadingProgress(token, readingArticleId, progress).catch(() => undefined);
    };
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(sendProgress, 900);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") sendProgress();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("pagehide", sendProgress);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule();
    return () => {
      sendProgress();
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pagehide", sendProgress);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [article?.resource.accessible, initialReadingProgress, isLoggedIn, readingArticleId]);

  useEffect(() => {
    restoredReadingPositionRef.current = false;
  }, [readingArticleId]);

  useEffect(() => {
    if (!article || restoredReadingPositionRef.current || searchParams.get("resume") !== "1") return;
    const progress = article.readingProgress ?? 0;
    const element = readingContentRef.current;
    if (!element || progress < 2) return;
    restoredReadingPositionRef.current = true;
    const timer = window.setTimeout(() => {
      const top = window.scrollY + element.getBoundingClientRect().top;
      const target = top + element.offsetHeight * (progress / 100) - window.innerHeight * 0.28;
      window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [article, searchParams]);

  useEffect(() => {
    if (!article || requestedCommentId <= 0 || comments.some((comment) => comment.id === requestedCommentId)) return;
    if (requestedCommentLoadRef.current === requestedCommentId) return;
    requestedCommentLoadRef.current = requestedCommentId;
    const token = readAccessToken();
    void listArticleComments(article.slug, token ?? undefined, {
      pageSize: COMMENT_PAGE_SIZE,
      focusId: requestedCommentId,
    }).then((page) => {
      setComments((current) => mergeArticleComments(current, page.items));
    }).catch(() => undefined);
  }, [article, comments, requestedCommentId]);

  const loadMoreComments = useCallback(async () => {
    if (!article || !hasMoreComments || !commentNextCursor || isLoadingMoreComments) return;
    setIsLoadingMoreComments(true);
    try {
      const token = readAccessToken();
      const page = await listArticleComments(article.slug, token ?? undefined, {
        cursor: commentNextCursor,
        pageSize: COMMENT_PAGE_SIZE,
      });
      setComments((current) => mergeArticleComments(current, page.items));
      setCommentNextCursor(page.nextCursor);
      setHasMoreComments(page.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "更多评论加载失败。");
    } finally {
      setIsLoadingMoreComments(false);
    }
  }, [article, commentNextCursor, hasMoreComments, isLoadingMoreComments]);

  useEffect(() => {
    if (requestedCommentId <= 0 || !comments.some((comment) => comment.id === requestedCommentId)) return;
    // Notification links can change only the query string while staying on the same article.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightCommentId(requestedCommentId);
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`article-comment-${requestedCommentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clearTimer = window.setTimeout(() => setHighlightCommentId(null), 3600);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [comments, requestedCommentId]);

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
      if (kind === "like" && !article.liked && result.liked) {
        setArticleLikeBurst((current) => current + 1);
      }
      if (kind === "favorite" && !article.favorited && result.favorited) {
        setArticleFavoriteBurst((current) => current + 1);
      }
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

  async function handleSubscription() {
    if (!article || user?.id === article.author.id) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    try {
      const result = authorProfile?.subscribed
        ? await unsubscribeFromAuthor(token, article.author.id)
        : await subscribeToAuthor(token, article.author.id);
      if (!authorProfile?.subscribed && result.subscribed) {
        setSubscriptionBurst((current) => current + 1);
      }
      setAuthorProfile((current) => current ? { ...current, ...result } : current);
      setNotice(result.subscribed ? "已订阅该作者。" : "已取消订阅。");
      notifySocialStateChange();
    } catch (subscriptionError) {
      setError(subscriptionError instanceof Error ? subscriptionError.message : "订阅操作失败。");
    }
  }

  async function handleReadLater() {
    if (!article) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    try {
      const result = await setArticleReadLater(token, article.id, !article.readLater);
      setArticle((current) => current ? { ...current, readLater: result.readLater } : current);
      setNotice(result.readLater ? "已加入稍后读。" : "已从稍后读移除。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "稍后读操作失败。");
    }
  }

  async function handleResourceRedeem() {
    if (!article) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    if (!window.confirm(`确定使用 ${article.resource.pointCost} 积分永久解锁这篇资源文章吗？`)) return;
    setIsRedeemingResource(true);
    setError("");
    try {
      const unlocked = await redeemArticleResource(token, article.id);
      setArticle(unlocked);
      setNotice(`已使用 ${article.resource.pointCost} 积分兑换，资源已永久解锁。`);
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "资源兑换失败。");
    } finally {
      setIsRedeemingResource(false);
    }
  }

  async function handleCommentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!article || !commentDraft.trim()) return;
    if (siteSettings && !siteSettings.commentsEnabled) {
      setError("评论功能暂未开放。");
      return;
    }
    const token = readAccessToken();
    if (!token) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    setIsSubmittingComment(true);
    try {
      const comment = await createArticleComment(token, article.id, commentDraft.trim(), replyingTo?.id);
      setComments((current) => mergeArticleComments(current, [comment]));
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
    if (siteSettings && !siteSettings.commentsEnabled) {
      setError("评论功能暂未开放。");
      return;
    }
    if (!readAccessToken()) {
      router.push(`/login?from=${encodeURIComponent(`/articles/${article.slug}`)}`);
      return;
    }
    setReplyingTo(comment);
    window.requestAnimationFrame(() => {
      const composer = composerRef.current;
      if (!composer) return;
      composer.closest("form")?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => composer.focus({ preventScroll: true }), 180);
    });
  }

  async function handleCommentDelete(comment: ArticleComment) {
    const token = readAccessToken();
    if (!token || !article || !window.confirm("确定删除这条评论吗？")) return;
    try {
      await deleteArticleComment(token, comment.id);
      const refreshed = await listArticleComments(article.slug, token, { pageSize: COMMENT_PAGE_SIZE });
      setComments(refreshed.items);
      setCommentNextCursor(refreshed.nextCursor);
      setHasMoreComments(refreshed.hasMore);
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
      if (!comment.liked && result.liked) {
        setCommentLikeBursts((current) => ({
          ...current,
          [comment.id]: (current[comment.id] ?? 0) + 1,
        }));
      }
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : "点赞失败。");
    }
  }

  async function handleReportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !reportingComment) return;
    if (siteSettings && !siteSettings.reportsEnabled) {
      setError("举报功能暂未开放。");
      return;
    }
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
      <div className={`${parent ? "article-comment-wrap reply" : "article-comment-wrap"}${highlightCommentId === comment.id ? " notification-highlight" : ""}`} id={`article-comment-${comment.id}`} key={comment.id}>
        <article className={`${parent ? "article-comment reply" : "article-comment"}${comment.status !== "active" ? " unavailable" : ""}`}>
          <div className="article-comment-heading">
            <CommentAuthorIdentity author={comment.author} />
            {parent ? <span className="article-reply-target"><CornerDownRight aria-hidden="true" size={13} />回复 @{parent.author.nickname}</span> : null}
            <time>{formatArticleDate(comment.createdAt)}</time>
          </div>
          <p>{comment.body}</p>
          {comment.status === "active" ? <div className="article-comment-actions">
            <span className="like-action-wrap compact"><button className={comment.liked ? "active" : undefined} onClick={() => void handleCommentLike(comment)} type="button"><ThumbsUp aria-hidden="true" fill={comment.liked ? "currentColor" : "none"} size={14} />{comment.likeCount || "点赞"}</button><LikeBurst burst={commentLikeBursts[comment.id] ?? 0} variant="thumb" /></span>
            {siteSettings?.commentsEnabled !== false ? <button onClick={() => beginReply(comment)} type="button"><Reply aria-hidden="true" size={14} />回复</button> : null}
            {siteSettings?.reportsEnabled !== false && user?.id !== comment.author.id ? <button className={comment.reported ? "active" : undefined} disabled={comment.reported} onClick={() => setReportingComment(comment)} type="button"><Flag aria-hidden="true" size={14} />{comment.reported ? "已举报" : "举报"}</button> : null}
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
      <article className="article-reading-layout">
        <header className="article-reading-header">
          <div className="article-reading-title-row"><h1 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h1><button className={article.readLater ? "active" : undefined} onClick={() => void handleReadLater()} type="button"><Clock3 aria-hidden="true" fill={article.readLater ? "currentColor" : "none"} size={16} />{article.readLater ? "已加入稍后读" : "稍后读"}</button></div>
          <div className="article-reading-author"><ArticleAuthorLine author={article.author} interactive /><span className="article-reading-divider" /><span>发布于 {formatArticleDate(article.publishedAt)}</span></div>
        </header>
        <div className="article-reading-grid">
          <aside className="article-reading-aside">
            <div className="article-aside-author">
              <div className="article-aside-author-profile"><ArticleAuthorLine author={article.author} interactive /><span>@{article.author.username}</span></div>
              {user?.id !== article.author.id ? <span className="like-action-wrap article-subscribe-action"><button className={authorProfile?.subscribed ? "active" : undefined} onClick={() => void handleSubscription()} type="button"><Rss aria-hidden="true" size={16} />{authorProfile?.subscribed ? "已订阅" : "订阅"}{authorProfile?.subscriberCount ? ` ${authorProfile.subscriberCount}` : ""}</button><LikeBurst burst={subscriptionBurst} variant="rss" /></span> : null}
            </div>
            <div className="article-reading-actions">
              <span className="like-action-wrap"><button className={article.liked ? "active" : undefined} onClick={() => void handleInteraction("like")} type="button"><Heart aria-hidden="true" fill={article.liked ? "currentColor" : "none"} size={17} />{article.liked ? "已赞" : "点赞"}</button><LikeBurst burst={articleLikeBurst} variant="heart" /></span>
              <span className="like-action-wrap"><button className={article.favorited ? "active" : undefined} onClick={() => void handleInteraction("favorite")} type="button"><Bookmark aria-hidden="true" fill={article.favorited ? "currentColor" : "none"} size={17} />{article.favorited ? "已收藏" : "收藏"}</button><LikeBurst burst={articleFavoriteBurst} variant="bookmark" /></span>
            </div>
            <ArticleStats article={article} />
            <dl className="article-aside-meta">
              <div><dt><Tag aria-hidden="true" size={15} />分类</dt><dd>{article.category || "随笔"}</dd></div>
              <div><dt><CalendarDays aria-hidden="true" size={15} />发布时间</dt><dd>{formatArticleDate(article.publishedAt)}</dd></div>
              <div><dt>更新时间</dt><dd>{formatArticleDate(article.updatedAt)}</dd></div>
              {article.resource.enabled ? <div><dt><Coins aria-hidden="true" size={15} />积分资源</dt><dd>{article.resource.pointCost} 积分{article.resource.redeemed ? " · 已兑换" : ""}</dd></div> : null}
            </dl>
            {article.tags.length ? <div className="article-tag-list">{article.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
            {article.collections.length || article.topics.length ? <div className="article-group-list">{article.collections.map((collection) => <Link className="article-group-chip collection" href={collection.href} key={`collection-${collection.id}`}>{collection.label}</Link>)}{article.topics.map((topic) => <Link className="article-group-chip topic" href={topic.href} key={`topic-${topic.id}`}>{topic.label}</Link>)}</div> : null}
          </aside>
          <main className="article-reading-main" ref={readingContentRef}>{article.resource.accessible ? <ArticleBody content={article.content} /> : <section className="article-resource-lock"><LockKeyhole aria-hidden="true" size={28} /><div><span>积分资源</span><h2>{article.resource.pointCost} 积分永久解锁</h2><p>{article.summary || "兑换后可以阅读完整正文。积分会转入作者账户。"}</p></div><button disabled={isRedeemingResource} onClick={() => void handleResourceRedeem()} type="button"><Coins aria-hidden="true" size={17} />{isRedeemingResource ? "兑换中" : isLoggedIn ? "兑换资源" : "登录后兑换"}</button></section>}</main>
        </div>
      </article>

      {article.resource.accessible ? <section className="article-comments-section">
        <div className="article-section-heading"><div><span className="section-label">Conversation</span><h2>评论与回复</h2></div><span>{article.commentCount} 条</span></div>
        {siteSettings?.commentsEnabled === false ? <div className="article-empty-inline"><MessageCircle aria-hidden="true" size={18} />评论功能暂未开放。</div> : <form className="article-comment-form" onSubmit={handleCommentSubmit}>
          <div aria-hidden={!replyingTo} className={`article-composer-context${replyingTo ? " active" : ""}`}>
            {replyingTo ? <><span title={`回复 @${replyingTo.author.nickname}`}>回复 <strong>@{replyingTo.author.nickname}</strong></span><button aria-label="取消回复" onClick={() => setReplyingTo(null)} title="取消回复" type="button"><X aria-hidden="true" size={14} /></button></> : null}
          </div>
          <div className="article-comment-input-wrap"><textarea aria-label={replyingTo ? `回复 ${replyingTo.author.nickname}` : "评论文章"} maxLength={2000} onChange={(event) => setCommentDraft(event.target.value)} placeholder={replyingTo ? `回复 @${replyingTo.author.nickname}` : "写下你的想法"} ref={composerRef} rows={3} value={commentDraft} /><button aria-label={replyingTo ? "发送回复" : "发送评论"} disabled={isSubmittingComment || !commentDraft.trim()} title={replyingTo ? "发送回复" : "发送评论"} type="submit"><Send aria-hidden="true" size={17} /></button></div>
          <div className="article-composer-footer">
            <span className="article-composer-count">{commentDraft.length} / 2000</span>
          </div>
        </form>}
        {commentThreads.length ? <>
          <div className="article-comments-list">{commentThreads.map((thread) => <section className="article-comment-thread" key={thread.root.id}>{renderComment(thread.root)}{thread.replies.length ? <div className="article-comment-replies">{thread.replies.map(({ comment, parent }) => renderComment(comment, parent ?? thread.root))}</div> : null}</section>)}</div>
          <ArticleInfiniteFooter hasMore={hasMoreComments} isLoading={isLoadingMoreComments} onLoadMore={() => void loadMoreComments()} />
        </> : <div className="article-empty-inline"><MessageCircle aria-hidden="true" size={18} />还没有评论。</div>}
      </section> : null}
      {reportingComment ? <div className="comment-report-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setReportingComment(null); }}><form className="comment-report-dialog" onSubmit={handleReportSubmit}><div><strong>举报评论</strong><button aria-label="关闭举报窗口" onClick={() => setReportingComment(null)} type="button"><X aria-hidden="true" size={17} /></button></div><label>举报原因<select onChange={(event) => setReportReason(event.target.value as ArticleCommentReportReason)} value={reportReason}><option value="spam">垃圾广告</option><option value="harassment">辱骂骚扰</option><option value="illegal">违法违规</option><option value="privacy">隐私泄露</option><option value="misinformation">不实内容</option><option value="other">其他</option></select></label><label>补充说明<textarea maxLength={500} onChange={(event) => setReportDetail(event.target.value)} placeholder="可选，帮助管理员判断具体问题" rows={3} value={reportDetail} /></label><button className="button" disabled={isSubmittingReport} type="submit">{isSubmittingReport ? "提交中" : "提交举报"}</button></form></div> : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function mergeArticleComments(current: ArticleComment[], incoming: ArticleComment[]): ArticleComment[] {
  const comments = new Map(current.map((comment) => [comment.id, comment]));
  for (const comment of incoming) comments.set(comment.id, comment);
  return Array.from(comments.values()).sort((left, right) =>
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id - right.id
  );
}
