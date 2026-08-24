"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, FileWarning, ShieldAlert } from "lucide-react";
import { ArticleAuthorLine, ArticleBody, ArticleStats, formatArticleDate } from "@/components/article-ui";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getAdminArticle, type Article } from "@/lib/article-api";
import { isSiteManager } from "@/lib/user-permissions";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";

export default function ArticlePreviewPage({ params }: { params: { id: string } }) {
  const { locale, phrase } = useLanguage();
  const articleId = Number(params.id);
  const invalidArticleId = !Number.isInteger(articleId) || articleId <= 0;
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = `${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/articles/preview/${params.id}`, locale))}`;
      return;
    }
    if (invalidArticleId) return;
    Promise.all([getMe(token), getAdminArticle(token, articleId)])
      .then(([user, result]) => {
        if (!isSiteManager(user)) throw new Error(phrase("需要管理员权限。", "Administrator permission is required."));
        setArticle(result);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          window.location.href = localizedPath("/login", locale);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("文章预览加载失败。", "Could not load article preview."));
      })
      .finally(() => setIsLoading(false));
  }, [invalidArticleId, articleId, locale, params.id, phrase]);

  return (
    <section className="page-shell article-status-preview-page">
      <header className="article-status-preview-heading">
        <Link aria-label={phrase("返回违规作者", "Back to violations")} href={localizedPath("/admin/violations", locale)} title={phrase("返回违规作者", "Back to violations")}><ArrowLeft aria-hidden="true" size={18} /></Link>
        <div><span className="section-label"><FileWarning aria-hidden="true" size={14} /> ARTICLE PREVIEW</span><h1>{phrase("文章预览", "Article preview")}</h1><p>{phrase("用于查看不同状态下的文章内容，不改变文章状态。", "View article content in different states without changing its status.")}</p></div>
      </header>
      {invalidArticleId ? <div className="article-empty-state"><ShieldAlert aria-hidden="true" size={18} />{phrase("文章编号无效。", "Invalid article id.")}</div> : isLoading ? <div className="article-empty-state">{phrase("正在读取文章。", "Loading article.")}</div> : error ? <div className="article-empty-state"><ShieldAlert aria-hidden="true" size={18} />{error}</div> : article ? (
        <article className="article-status-preview-surface">
          <header className="article-status-preview-article-heading">
            <div><span className={`article-status-dot ${article.status}`}>{articleStatusLabel(article.status, phrase)}</span><h2>{article.title}</h2><div className="article-status-preview-meta"><ArticleAuthorLine author={article.author} /><span>{phrase("发布于", "Published")} {formatArticleDate(article.publishedAt, locale)}</span><span>{phrase("更新于", "Updated")} {formatArticleDate(article.updatedAt, locale)}</span></div></div>
            <ArticleStats article={article} />
          </header>
          {article.blockedReason ? <p className="article-status-preview-reason">{phrase("屏蔽说明：", "Block reason: ")}{article.blockedReason}</p> : null}
          <ArticleBody content={article.content} contentSegments={article.contentSegments} />
        </article>
      ) : null}
    </section>
  );
}

function articleStatusLabel(status: Article["status"], phrase: (chinese: string, english: string) => string) {
  const labels: Record<Article["status"], [string, string]> = {
    draft: ["草稿", "Draft"], published: ["已发布", "Published"], unpublished: ["已下架", "Unpublished"], blocked: ["已屏蔽", "Blocked"], deleted: ["已删除", "Deleted"],
  };
  const [chinese, english] = labels[status];
  return phrase(chinese, english);
}
