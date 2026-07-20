"use client";

import Link from "next/link";
import { Bookmark, Heart, MessageCircle, Send } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArticleAuthorLine, ArticleBody, ArticleStats, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  ArticleComment,
  createArticleComment,
  favoriteArticle,
  getPublicArticle,
  getVisibleArticle,
  likeArticle,
  listArticleComments,
} from "@/lib/article-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function ArticleDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const slug = params.slug;
    if (!slug) return;
    const token = readAccessToken();
    Promise.all([
      token ? getVisibleArticle(token, slug) : getPublicArticle(slug),
      listArticleComments(slug, token ?? undefined),
    ])
      .then(([loadedArticle, loadedComments]) => {
        setArticle(loadedArticle);
        setComments(loadedComments.items);
      })
      .catch(async (loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          try {
            const loadedArticle = await getPublicArticle(slug);
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
      const comment = await createArticleComment(token, article.id, commentDraft.trim());
      setComments((current) => [...current, comment]);
      setArticle({ ...article, commentCount: article.commentCount + 1 });
      setCommentDraft("");
      setNotice("评论已发布。");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "评论发布失败。");
    } finally {
      setIsSubmittingComment(false);
    }
  }

  if (isLoading) return <section className="page-shell article-detail-page"><div className="article-empty-state">正在读取文章。</div></section>;
  if (!article) return <section className="page-shell article-detail-page"><div className="article-empty-state"><strong>文章暂时无法打开</strong><span>{error || "文章不存在或没有阅读权限。"}</span><Link className="text-action" href="/articles">返回文章列表</Link></div></section>;

  return (
    <section className="page-shell article-detail-page">
      <Link className="article-back-link" href="/articles">返回文章</Link>
      <article className="article-reading-layout">
        <header className="article-reading-header">
          <div className="article-reading-meta"><span>{article.category || "随笔"}</span><span>{formatArticleDate(article.publishedAt)}</span>{article.isPinned ? <span>置顶</span> : null}</div>
          <h1 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h1>
          {article.summary ? <p className="article-reading-summary">{article.summary}</p> : null}
          <div className="article-reading-author"><ArticleAuthorLine author={article.author} /><span className="article-reading-divider" /><span>发布于 {formatArticleDate(article.publishedAt)}</span></div>
        </header>
        <div className="article-reading-actions">
          <button className={article.liked ? "active" : undefined} onClick={() => void handleInteraction("like")} type="button"><Heart aria-hidden="true" size={17} />{article.liked ? "已赞" : "点赞"}</button>
          <button className={article.favorited ? "active" : undefined} onClick={() => void handleInteraction("favorite")} type="button"><Bookmark aria-hidden="true" size={17} />{article.favorited ? "已收藏" : "收藏"}</button>
          <ArticleStats article={article} />
        </div>
        <ArticleBody content={article.content} />
        {article.tags.length ? <div className="article-tag-list">{article.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
      </article>

      <section className="article-comments-section">
        <div className="article-section-heading"><div><span className="section-label">Conversation</span><h2>评论与回复</h2></div><span>{comments.length} 条</span></div>
        {comments.length ? <div className="article-comments-list">{comments.map((comment) => <article className="article-comment" key={comment.id}><ArticleAuthorLine author={comment.author} /><time>{formatArticleDate(comment.createdAt)}</time><p>{comment.body}</p></article>)}</div> : <div className="article-empty-inline"><MessageCircle aria-hidden="true" size={18} />还没有评论。</div>}
        <form className="article-comment-form" onSubmit={handleCommentSubmit}>
          <textarea maxLength={2000} onChange={(event) => setCommentDraft(event.target.value)} placeholder="写下你的想法" rows={3} value={commentDraft} />
          <button className="button" disabled={isSubmittingComment || !commentDraft.trim()} type="submit"><Send aria-hidden="true" size={16} />{isSubmittingComment ? "发布中" : "发布评论"}</button>
        </form>
      </section>
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
