"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bookmark, Eye, Heart, MessageCircle, Pin } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Article, ArticleAuthor } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { getAvatarFallbackText } from "@/lib/user-display";

export function formatArticleDate(value: string | null): string {
  if (!value) return "尚未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ArticleAuthorLine({ author }: { author: ArticleAuthor }) {
  const avatar = author.avatarUrl ? resolveApiUrl(author.avatarUrl) : null;
  return (
    <span className="article-author-line">
      <span className="article-author-avatar">
        {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
      </span>
      <span>{author.nickname}</span>
    </span>
  );
}

export function ArticleStats({ article, compact = false }: { article: Article; compact?: boolean }) {
  return (
    <span className={`article-stats${compact ? " compact" : ""}`}>
      <span title="阅读量"><Eye aria-hidden="true" size={compact ? 13 : 15} />{article.viewCount}</span>
      <span title="点赞数"><Heart aria-hidden="true" size={compact ? 13 : 15} />{article.likeCount}</span>
      <span title="评论数"><MessageCircle aria-hidden="true" size={compact ? 13 : 15} />{article.commentCount}</span>
      <span title="收藏数"><Bookmark aria-hidden="true" size={compact ? 13 : 15} />{article.favoriteCount}</span>
    </span>
  );
}

export function ArticleCard({ article }: { article: Article }) {
  return (
    <Link className="article-card" href={`/articles/${article.slug}`}>
      <div className="article-card-topline">
        {article.isPinned ? <span className="article-pin-label"><Pin aria-hidden="true" size={13} />置顶</span> : <span className="article-category">{article.category || "随笔"}</span>}
        <span>{formatArticleDate(article.publishedAt)}</span>
      </div>
      <h2 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h2>
      <p>{article.summary || article.content.replace(/[#>*`\[\]]/g, "").slice(0, 120)}</p>
      <div className="article-card-bottom">
        <ArticleAuthorLine author={article.author} />
        <ArticleStats article={article} compact />
      </div>
    </Link>
  );
}

export function ArticleBody({
  content,
  pendingImageUrls,
}: {
  content: string;
  pendingImageUrls?: Record<string, string>;
}) {
  return (
    <div className="article-body">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => safeArticleUrl(href)
            ? <a href={href} rel="noreferrer" target="_blank">{children}</a>
            : <span>{children}</span>,
          img: ({ alt, src }) => {
            if (!safeArticleUrl(src)) return null;
            const resolvedSource = pendingImageUrls?.[src] ?? resolveApiUrl(src);
            return <img alt={alt ?? ""} className="article-body-image" src={resolvedSource} />;
          },
          pre: ({ children }) => <pre className="article-code">{children}</pre>,
          table: ({ children }) => <div className="article-table-wrap"><table>{children}</table></div>,
        }}
        rehypePlugins={[rehypeSanitize]}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {content.replaceAll("\r\n", "\n")}
      </ReactMarkdown>
    </div>
  );
}

function safeArticleUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/") || /^https?:\/\//i.test(value));
}
