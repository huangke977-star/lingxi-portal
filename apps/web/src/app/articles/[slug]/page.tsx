"use client";

import Link from "next/link";
import { Bookmark, CalendarDays, Clock3, Coins, CornerDownRight, Flag, Heart, MessageCircle, Reply, Rss, Tag, ThumbsUp, Trash2, X } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleAuthorLine, ArticleBody, ArticleStats, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { ContentAttachmentComposer, ContentAttachmentList } from "@/components/content-attachment-composer";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { LikeBurst } from "@/components/like-burst";
import { getActiveMention, MentionSuggestions, MentionText } from "@/components/mention-ui";
import { CommentAuthorIdentity } from "@/components/public-profile-popover";
import {
  Article,
  ArticleComment,
  ArticleCommentReportReason,
  ArticleReportReason,
  createArticleComment,
  deleteArticleComment,
  favoriteArticle,
  getPublicArticle,
  getVisibleArticle,
  likeArticle,
  likeArticleComment,
  listArticleComments,
  reportArticleComment,
  reportArticle,
  redeemArticleResource,
  setArticleReadLater,
  updateArticleReadingProgress,
} from "@/lib/article-api";
import { buildArticleCommentThreads } from "@/lib/article-comments";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";
import { getPublicProfile, PublicProfile, searchSocialUsers, SocialUserSearchResult, subscribeToAuthor, unsubscribeFromAuthor } from "@/lib/social-api";
import { notifySocialStateChange } from "@/lib/social-events";

const COMMENT_PAGE_SIZE = 10;

function reportReasonOptions(phrase: (chinese: string, english: string) => string) {
  return [
    { value: "spam", label: phrase("垃圾广告", "Spam or advertising") },
    { value: "harassment", label: phrase("辱骂骚扰", "Harassment") },
    { value: "illegal", label: phrase("违法违规", "Illegal content") },
    { value: "privacy", label: phrase("隐私泄露", "Privacy violation") },
    { value: "misinformation", label: phrase("不实内容", "Misinformation") },
    { value: "other", label: phrase("其他", "Other") },
  ] as const;
}

export default function ArticleDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, phrase } = useLanguage();
  const { confirm } = useConfirm();
  const [article, setArticle] = useState<Article | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentNextCursor, setCommentNextCursor] = useState<number | null>(null);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [isLoadingMoreComments, setIsLoadingMoreComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentMentionCandidates, setCommentMentionCandidates] = useState<SocialUserSearchResult[]>([]);
  const [isCommentMentionSearching, setIsCommentMentionSearching] = useState(false);
  const [commentMentionRange, setCommentMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [commentMentionCursor, setCommentMentionCursor] = useState(0);
  const [replyingTo, setReplyingTo] = useState<ArticleComment | null>(null);
  const [reportingComment, setReportingComment] = useState<ArticleComment | null>(null);
  const [reportingArticle, setReportingArticle] = useState(false);
  const [reportReason, setReportReason] = useState<ArticleCommentReportReason>("spam");
  const [reportDetail, setReportDetail] = useState("");
  const [articleReportReason, setArticleReportReason] = useState<ArticleReportReason>("spam");
  const [articleReportDetail, setArticleReportDetail] = useState("");
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
    const token = readAccessToken();
    const activeMention = getActiveMention(commentDraft, commentMentionCursor);
    if (!token || !activeMention || activeMention.query.length < 2) {
      // Suggestions mirror the textarea caret and must be reset when that external state changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCommentMentionCandidates([]);
      setCommentMentionRange(activeMention ? { start: activeMention.start, end: activeMention.end } : null);
      setIsCommentMentionSearching(false);
      return;
    }
    setCommentMentionRange({ start: activeMention.start, end: activeMention.end });
    let active = true;
    const timer = window.setTimeout(() => {
      setIsCommentMentionSearching(true);
      searchSocialUsers(token, activeMention.query, 8)
        .then((result) => { if (active) setCommentMentionCandidates(result.items); })
        .catch(() => { if (active) setCommentMentionCandidates([]); })
        .finally(() => { if (active) setIsCommentMentionSearching(false); });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [commentDraft, commentMentionCursor]);

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
            setError(fallbackError instanceof Error ? fallbackError.message : phrase("文章加载失败。", "Could not load this article."));
            return;
          }
        }
        setError(loadError instanceof Error ? loadError.message : phrase("文章加载失败。", "Could not load this article."));
      })
      .finally(() => setIsLoading(false));
  }, [params.slug, phrase, requestedCommentId]);

  useEffect(() => {
    if (!readingArticleId || !isLoggedIn || !readingContentRef.current) return;
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
  }, [initialReadingProgress, isLoggedIn, readingArticleId]);

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
      setError(loadError instanceof Error ? loadError.message : phrase("更多评论加载失败。", "Could not load more comments."));
    } finally {
      setIsLoadingMoreComments(false);
    }
  }, [article, commentNextCursor, hasMoreComments, isLoadingMoreComments, phrase]);

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
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
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
      setError(interactionError instanceof Error ? interactionError.message : phrase("操作失败。", "Action failed."));
    }
  }

  async function handleSubscription() {
    if (!article || user?.id === article.author.id) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
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
      setNotice(result.subscribed ? phrase("已订阅该作者。", "Subscribed to this author.") : phrase("已取消订阅。", "Subscription canceled."));
      notifySocialStateChange();
    } catch (subscriptionError) {
      setError(subscriptionError instanceof Error ? subscriptionError.message : phrase("订阅操作失败。", "Could not update subscription."));
    }
  }

  async function handleReadLater() {
    if (!article) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
      return;
    }
    try {
      const result = await setArticleReadLater(token, article.id, !article.readLater);
      setArticle((current) => current ? { ...current, readLater: result.readLater } : current);
      setNotice(result.readLater ? phrase("已加入稍后读。", "Added to read later.") : phrase("已从稍后读移除。", "Removed from read later."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("稍后读操作失败。", "Could not update read later."));
    }
  }

  async function handleResourceRedeem(blockKey: string) {
    if (!article) return;
    if (isRedeemingResource) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
      return;
    }
    const block = article.resource.blocks.find((item) => item.key === blockKey);
    if (!block || block.unlocked) return;
    if (!(await confirm(phrase(`确定使用 ${block.pointCost} 积分永久解锁这段内容吗？`, `Use ${block.pointCost} points to permanently unlock this section?`)))) return;
    setIsRedeemingResource(true);
    setError("");
    try {
      const unlocked = await redeemArticleResource(token, article.id, blockKey);
      setArticle(unlocked);
      setNotice(phrase(`已使用 ${block.pointCost} 积分兑换，内容已永久解锁。`, `Used ${block.pointCost} points. This section is permanently unlocked.`));
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : phrase("资源兑换失败。", "Could not redeem this resource."));
    } finally {
      setIsRedeemingResource(false);
    }
  }

  async function handleArticleReportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!article || !reportingArticle) return;
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
      return;
    }
    if (siteSettings && !siteSettings.reportsEnabled) {
      setError(phrase("举报功能暂未开放。", "Reports are not available."));
      return;
    }
    setIsSubmittingReport(true);
    try {
      await reportArticle(token, article.id, { reason: articleReportReason, detail: articleReportDetail.trim() || undefined });
      setReportingArticle(false);
      setArticleReportDetail("");
      setNotice(phrase("文章举报已提交，管理员会尽快处理。", "Article report submitted. Administrators will review it soon."));
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : phrase("文章举报提交失败。", "Could not submit article report."));
    } finally {
      setIsSubmittingReport(false);
    }
  }

  async function handleCommentSubmit(files: File[]): Promise<boolean> {
    if (!article || (!commentDraft.trim() && !files.length)) return false;
    if (siteSettings && !siteSettings.commentsEnabled) {
      setError(phrase("评论功能暂未开放。", "Comments are not available."));
      return false;
    }
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
      return false;
    }
    setIsSubmittingComment(true);
    try {
      const comment = await createArticleComment(token, article.id, commentDraft, replyingTo?.id, files, replyingTo?.id);
      setComments((current) => mergeArticleComments(current, [comment]));
      setArticle((current) => current ? { ...current, commentCount: current.commentCount + 1 } : current);
      setCommentDraft("");
      setReplyingTo(null);
      setNotice(replyingTo ? phrase("回复已发布。", "Reply posted.") : phrase("评论已发布。", "Comment posted."));
      return true;
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : phrase("评论发布失败。", "Could not post comment."));
      return false;
    } finally {
      setIsSubmittingComment(false);
    }
  }

  function insertCommentMention(user: SocialUserSearchResult) {
    if (!commentMentionRange) return;
    const nextDraft = `${commentDraft.slice(0, commentMentionRange.start)}@${user.username} ${commentDraft.slice(commentMentionRange.end)}`;
    const nextCursor = commentMentionRange.start + user.username.length + 2;
    setCommentDraft(nextDraft);
    setCommentMentionCandidates([]);
    setCommentMentionRange(null);
    setCommentMentionCursor(nextCursor);
    window.requestAnimationFrame(() => {
      const textarea = composerRef.current;
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function beginReply(comment: ArticleComment) {
    if (!article) return;
    if (siteSettings && !siteSettings.commentsEnabled) {
      setError(phrase("评论功能暂未开放。", "Comments are not available."));
      return;
    }
    if (!readAccessToken()) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article.slug}`, locale))}`);
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
    if (!token || !article || !(await confirm(phrase("确定删除这条评论吗？", "Delete this comment?")))) return;
    try {
      await deleteArticleComment(token, comment.id);
      const refreshed = await listArticleComments(article.slug, token, { pageSize: COMMENT_PAGE_SIZE });
      setComments(refreshed.items);
      setCommentNextCursor(refreshed.nextCursor);
      setHasMoreComments(refreshed.hasMore);
      setArticle((current) => current ? { ...current, commentCount: Math.max(0, current.commentCount - 1) } : current);
      if (replyingTo?.id === comment.id) setReplyingTo(null);
      setNotice(phrase("评论已删除。", "Comment deleted."));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("评论删除失败。", "Could not delete comment."));
    }
  }

  async function handleCommentLike(comment: ArticleComment) {
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/${article?.slug ?? ""}`, locale))}`);
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
      setError(likeError instanceof Error ? likeError.message : phrase("点赞失败。", "Could not update like."));
    }
  }

  async function handleReportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !reportingComment) return;
    if (siteSettings && !siteSettings.reportsEnabled) {
      setError(phrase("举报功能暂未开放。", "Reports are not available."));
      return;
    }
    setIsSubmittingReport(true);
    try {
      await reportArticleComment(token, reportingComment.id, { reason: reportReason, detail: reportDetail.trim() || undefined });
      setComments((current) => current.map((item) => item.id === reportingComment.id ? { ...item, reported: true } : item));
      setReportingComment(null);
      setReportDetail("");
      setNotice(phrase("举报已提交，管理员会尽快处理。", "Report submitted. Administrators will review it soon."));
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : phrase("举报提交失败。", "Could not submit report."));
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
            {parent ? <span className="article-reply-target"><CornerDownRight aria-hidden="true" size={13} />{phrase(`回复 @${parent.author.nickname}`, `Reply to @${parent.author.nickname}`)}</span> : null}
            <time>{formatArticleDate(comment.createdAt, locale)}</time>
          </div>
          {comment.quote ? <button className={`article-comment-quote${comment.quote.available ? "" : " unavailable"}`} onClick={() => comment.quote?.available && document.getElementById(`article-comment-${comment.quote.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} type="button"><CornerDownRight aria-hidden="true" size={13} /><span><strong>{comment.quote.authorName}</strong><small>{comment.quote.available ? comment.quote.body || phrase("原评论没有文字内容。", "The original comment has no text.") : phrase("原评论已不可见。", "The original comment is no longer available.")}</small></span></button> : null}
          {comment.attachments?.length ? <ContentAttachmentList attachments={comment.attachments} /> : null}
          {comment.body ? <p><MentionText text={comment.body} /></p> : null}
          {comment.status === "active" ? <div className="article-comment-actions">
            <span className="like-action-wrap compact"><button className={comment.liked ? "active" : undefined} onClick={() => void handleCommentLike(comment)} type="button"><ThumbsUp aria-hidden="true" fill={comment.liked ? "currentColor" : "none"} size={14} />{comment.likeCount || phrase("点赞", "Like")}</button><LikeBurst burst={commentLikeBursts[comment.id] ?? 0} variant="thumb" /></span>
            {siteSettings?.commentsEnabled !== false ? <button onClick={() => beginReply(comment)} type="button"><Reply aria-hidden="true" size={14} />{phrase("回复", "Reply")}</button> : null}
            {siteSettings?.reportsEnabled !== false && user?.id !== comment.author.id ? <button className={comment.reported ? "active" : undefined} disabled={comment.reported} onClick={() => setReportingComment(comment)} type="button"><Flag aria-hidden="true" size={14} />{comment.reported ? phrase("已举报", "Reported") : phrase("举报", "Report")}</button> : null}
            {user?.id === comment.author.id ? <button className="text-danger-action" onClick={() => void handleCommentDelete(comment)} type="button"><Trash2 aria-hidden="true" size={14} />{phrase("删除", "Delete")}</button> : null}
          </div> : null}
        </article>
      </div>
    );
  }

  if (isLoading) return <section className="page-shell article-detail-page"><div className="article-empty-state">{phrase("正在读取文章。", "Loading article.")}</div></section>;
  if (!article) return <section className="page-shell article-detail-page"><div className="article-empty-state"><strong>{phrase("文章暂时无法打开", "Article unavailable")}</strong><span>{error || phrase("文章不存在或没有阅读权限。", "This article does not exist or you do not have permission to read it.")}</span><Link className="text-action" href={localizedPath("/articles", locale)}>{phrase("返回文章列表", "Back to articles")}</Link></div></section>;

  return (
    <section className="page-shell article-detail-page">
      <ArticleCenterNav active="discover" isLoggedIn={isLoggedIn} user={user} />
      <article className="article-reading-layout">
        <header className="article-reading-header">
          <div className="article-reading-title-row"><h1 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h1></div>
          <div className="article-reading-author"><span className="article-reading-author-main"><ArticleAuthorLine author={article.author} interactive /><span className="article-reading-divider" /><span>{phrase("发布于", "Published")} {formatArticleDate(article.publishedAt, locale)}</span></span><span className="article-reading-header-actions"><button className={article.readLater ? "active" : undefined} onClick={() => void handleReadLater()} type="button"><Clock3 aria-hidden="true" fill={article.readLater ? "currentColor" : "none"} size={16} />{article.readLater ? phrase("已加入稍后读", "In read later") : phrase("稍后读", "Read later")}</button>{user?.id !== article.author.id ? <button onClick={() => setReportingArticle(true)} type="button"><Flag aria-hidden="true" size={16} />{phrase("举报", "Report")}</button> : null}</span></div>
        </header>
        <div className="article-reading-grid">
          <aside className="article-reading-aside">
            <div className="article-aside-author">
              <div className="article-aside-author-profile"><ArticleAuthorLine author={article.author} interactive /><span>@{article.author.username}</span></div>
              {user?.id !== article.author.id ? <span className="like-action-wrap article-subscribe-action"><button className={authorProfile?.subscribed ? "active" : undefined} onClick={() => void handleSubscription()} type="button"><Rss aria-hidden="true" size={16} />{authorProfile?.subscribed ? phrase("已订阅", "Subscribed") : phrase("订阅", "Subscribe")}{authorProfile?.subscriberCount ? ` ${authorProfile.subscriberCount}` : ""}</button><LikeBurst burst={subscriptionBurst} variant="rss" /></span> : null}
            </div>
            <div className="article-reading-actions">
              <span className="like-action-wrap"><button className={article.liked ? "active" : undefined} onClick={() => void handleInteraction("like")} type="button"><Heart aria-hidden="true" fill={article.liked ? "currentColor" : "none"} size={17} />{article.liked ? phrase("已赞", "Liked") : phrase("点赞", "Like")}</button><LikeBurst burst={articleLikeBurst} variant="heart" /></span>
              <span className="like-action-wrap"><button className={article.favorited ? "active" : undefined} onClick={() => void handleInteraction("favorite")} type="button"><Bookmark aria-hidden="true" fill={article.favorited ? "currentColor" : "none"} size={17} />{article.favorited ? phrase("已收藏", "Saved") : phrase("收藏", "Save")}</button><LikeBurst burst={articleFavoriteBurst} variant="bookmark" /></span>
            </div>
            <ArticleStats article={article} />
            <dl className="article-aside-meta">
              <div><dt><Tag aria-hidden="true" size={15} />{phrase("分类", "Category")}</dt><dd>{article.category || phrase("随笔", "Notes")}</dd></div>
              <div><dt><CalendarDays aria-hidden="true" size={15} />{phrase("发布时间", "Published")}</dt><dd>{formatArticleDate(article.publishedAt, locale)}</dd></div>
              <div><dt>{phrase("更新时间", "Updated")}</dt><dd>{formatArticleDate(article.updatedAt, locale)}</dd></div>
              {article.resource.enabled ? <div><dt><Coins aria-hidden="true" size={15} />{phrase("积分资源", "Points resource")}</dt><dd>{phrase(`${article.resource.blocks.length} 个区域`, `${article.resource.blocks.length} sections`)}</dd></div> : null}
            </dl>
            {article.tags.length ? <div className="article-tag-list">{article.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
            {article.collections.length || article.topics.length ? <div className="article-group-list">{article.collections.map((collection) => <Link className="article-group-chip collection" href={localizedPath(collection.href, locale)} key={`collection-${collection.id}`}>{collection.label}</Link>)}{article.topics.map((topic) => <Link className="article-group-chip topic" href={localizedPath(topic.href, locale)} key={`topic-${topic.id}`}>{topic.label}</Link>)}</div> : null}
          </aside>
          <main className="article-reading-main" ref={readingContentRef}><ArticleBody content={article.content} contentSegments={article.contentSegments} onRedeemResource={(blockKey) => void handleResourceRedeem(blockKey)} /></main>
        </div>
      </article>

      <section className="article-comments-section">
        <div className="article-section-heading"><div><span className="section-label">CONVERSATION</span><h2>{phrase("评论与回复", "Comments and replies")}</h2></div><span>{phrase(`${article.commentCount} 条`, `${article.commentCount} comments`)}</span></div>
        {siteSettings?.commentsEnabled === false ? <div className="article-empty-inline"><MessageCircle aria-hidden="true" size={18} />{phrase("评论功能暂未开放。", "Comments are not available.")}</div> : <div className="article-comment-form">
          <div aria-hidden={!replyingTo} className={`article-composer-context${replyingTo ? " active" : ""}`}>
            {replyingTo ? <><span title={phrase(`回复 @${replyingTo.author.nickname}`, `Reply to @${replyingTo.author.nickname}`)}>{phrase("回复", "Reply")} <strong>@{replyingTo.author.nickname}</strong></span><button aria-label={phrase("取消回复", "Cancel reply")} onClick={() => setReplyingTo(null)} title={phrase("取消回复", "Cancel reply")} type="button"><X aria-hidden="true" size={14} /></button></> : null}
          </div>
          <div className="mention-composer-shell"><ContentAttachmentComposer ariaLabel={replyingTo ? phrase(`回复 ${replyingTo.author.nickname}`, `Reply to ${replyingTo.author.nickname}`) : phrase("评论文章", "Comment on article")} isSubmitting={isSubmittingComment} onChange={(value) => { setCommentDraft(value); setCommentMentionCursor(composerRef.current?.selectionStart ?? value.length); }} onKeyDown={(event) => { if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && commentMentionCandidates.length) { event.preventDefault(); insertCommentMention(commentMentionCandidates[0]); return; } if (event.key === "Escape" && commentMentionCandidates.length) { event.preventDefault(); setCommentMentionCandidates([]); } }} onCursorChange={setCommentMentionCursor} onSubmit={handleCommentSubmit} placeholder={replyingTo ? phrase(`回复 @${replyingTo.author.nickname}`, `Reply to @${replyingTo.author.nickname}`) : phrase("写下你的想法", "Write your thoughts")} textareaRef={composerRef} value={commentDraft} /><MentionSuggestions isLoading={isCommentMentionSearching} items={commentMentionCandidates} onSelect={insertCommentMention} /></div>
          <div className="article-composer-footer">
            <span className="article-composer-count">{commentDraft.length} / 2000</span>
          </div>
        </div>}
        {commentThreads.length ? <>
          <div className="article-comments-list">{commentThreads.map((thread) => <section className="article-comment-thread" key={thread.root.id}>{renderComment(thread.root)}{thread.replies.length ? <div className="article-comment-replies">{thread.replies.map(({ comment, parent }) => renderComment(comment, parent ?? thread.root))}</div> : null}</section>)}</div>
          <ArticleInfiniteFooter hasMore={hasMoreComments} isLoading={isLoadingMoreComments} onLoadMore={() => void loadMoreComments()} />
        </> : <div className="article-empty-inline"><MessageCircle aria-hidden="true" size={18} />{phrase("还没有评论。", "No comments yet.")}</div>}
      </section>
      {reportingArticle ? <div className="comment-report-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setReportingArticle(false); }}><form className="comment-report-dialog" onSubmit={handleArticleReportSubmit}><div><strong>{phrase("举报文章", "Report article")}</strong><button aria-label={phrase("关闭举报窗口", "Close report dialog")} onClick={() => setReportingArticle(false)} type="button"><X aria-hidden="true" size={17} /></button></div><label>{phrase("举报原因", "Report reason")}<GlassSelect ariaLabel={phrase("举报原因", "Report reason")} onChange={(value) => setArticleReportReason(value as ArticleReportReason)} options={reportReasonOptions(phrase)} value={articleReportReason} /></label><label>{phrase("补充说明", "Additional details")}<textarea maxLength={500} onChange={(event) => setArticleReportDetail(event.target.value)} placeholder={phrase("可选，帮助管理员判断具体问题", "Optional. Help administrators understand the issue.")} rows={3} value={articleReportDetail} /></label><button className="button" disabled={isSubmittingReport} type="submit">{isSubmittingReport ? phrase("提交中", "Submitting") : phrase("提交举报", "Submit report")}</button></form></div> : null}
      {reportingComment ? <div className="comment-report-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setReportingComment(null); }}><form className="comment-report-dialog" onSubmit={handleReportSubmit}><div><strong>{phrase("举报评论", "Report comment")}</strong><button aria-label={phrase("关闭举报窗口", "Close report dialog")} onClick={() => setReportingComment(null)} type="button"><X aria-hidden="true" size={17} /></button></div><label>{phrase("举报原因", "Report reason")}<GlassSelect ariaLabel={phrase("举报原因", "Report reason")} onChange={(value) => setReportReason(value as ArticleCommentReportReason)} options={reportReasonOptions(phrase)} value={reportReason} /></label><label>{phrase("补充说明", "Additional details")}<textarea maxLength={500} onChange={(event) => setReportDetail(event.target.value)} placeholder={phrase("可选，帮助管理员判断具体问题", "Optional. Help administrators understand the issue.")} rows={3} value={reportDetail} /></label><button className="button" disabled={isSubmittingReport} type="submit">{isSubmittingReport ? phrase("提交中", "Submitting") : phrase("提交举报", "Submit report")}</button></form></div> : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function mergeArticleComments(current: ArticleComment[], incoming: ArticleComment[]): ArticleComment[] {
  const comments = new Map(current.map((comment) => [comment.id, comment]));
  for (const comment of incoming) comments.set(comment.id, comment);
  return Array.from(comments.values()).sort((left, right) =>
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || right.id - left.id
  );
}
