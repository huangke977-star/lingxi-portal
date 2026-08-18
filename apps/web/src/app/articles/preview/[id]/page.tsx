"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, FileWarning, ShieldAlert } from "lucide-react";
import { ArticleAuthorLine, ArticleBody, ArticleStats, formatArticleDate } from "@/components/article-ui";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getAdminArticle, type Article } from "@/lib/article-api";
import { isSiteManager } from "@/lib/user-permissions";

const STATUS_LABEL: Record<Article["status"], string> = {
  draft: "草稿",
  published: "已发布",
  unpublished: "已下架",
  blocked: "已屏蔽",
  deleted: "已删除",
};

export default function ArticlePreviewPage({ params }: { params: { id: string } }) {
  const articleId = Number(params.id);
  const invalidArticleId = !Number.isInteger(articleId) || articleId <= 0;
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = `/login?from=${encodeURIComponent(`/articles/preview/${params.id}`)}`;
      return;
    }
    if (invalidArticleId) return;
    Promise.all([getMe(token), getAdminArticle(token, articleId)])
      .then(([user, result]) => {
        if (!isSiteManager(user)) throw new Error("需要管理员权限。");
        setArticle(result);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          window.location.href = "/login";
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "文章预览加载失败。");
      })
      .finally(() => setIsLoading(false));
  }, [invalidArticleId, articleId, params.id]);

  return (
    <section className="page-shell article-status-preview-page">
      <header className="article-status-preview-heading">
        <Link aria-label="返回违规作者" href="/admin/violations" title="返回违规作者"><ArrowLeft aria-hidden="true" size={18} /></Link>
        <div><span className="section-label"><FileWarning aria-hidden="true" size={14} /> ARTICLE PREVIEW</span><h1>文章预览</h1><p>用于查看不同状态下的文章内容，不改变文章状态。</p></div>
      </header>
      {invalidArticleId ? <div className="article-empty-state"><ShieldAlert aria-hidden="true" size={18} />文章编号无效。</div> : isLoading ? <div className="article-empty-state">正在读取文章。</div> : error ? <div className="article-empty-state"><ShieldAlert aria-hidden="true" size={18} />{error}</div> : article ? (
        <article className="article-status-preview-surface">
          <header className="article-status-preview-article-heading">
            <div><span className={`article-status-dot ${article.status}`}>{STATUS_LABEL[article.status]}</span><h2>{article.title}</h2><div className="article-status-preview-meta"><ArticleAuthorLine author={article.author} /><span>发布于 {formatArticleDate(article.publishedAt)}</span><span>更新于 {formatArticleDate(article.updatedAt)}</span></div></div>
            <ArticleStats article={article} />
          </header>
          {article.blockedReason ? <p className="article-status-preview-reason">屏蔽说明：{article.blockedReason}</p> : null}
          <ArticleBody content={article.content} contentSegments={article.contentSegments} />
        </article>
      ) : null}
    </section>
  );
}
