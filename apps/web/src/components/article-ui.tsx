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

export function ArticlePinBadge({ isPinned }: { isPinned: boolean }) {
  if (!isPinned) return null;
  return (
    <span aria-label="置顶文章" className="article-pin-corner" role="img" title="置顶文章">
      <Pin aria-hidden="true" fill="currentColor" size={13} />
    </span>
  );
}

export function ArticleTaxonomy({ article, limit = 3 }: { article: Article; limit?: number }) {
  const visibleTags = article.tags.slice(0, limit);
  const hiddenCount = Math.max(0, article.tags.length - visibleTags.length);
  return (
    <span className="article-taxonomy">
      <span className="article-category">{article.category || "随笔"}</span>
      {visibleTags.map((tag) => <span className="article-tag-chip" key={tag}>#{tag}</span>)}
      {hiddenCount ? <span className="article-tag-more">+{hiddenCount}</span> : null}
    </span>
  );
}

export function RecentCommenters({ article }: { article: Article }) {
  const commenters = article.recentCommenters.filter(
    (author, index, authors) => authors.findIndex((candidate) => candidate.id === author.id) === index,
  ).slice(0, 5);
  if (!commenters.length) return null;
  return (
    <span aria-label="最近回复用户" className="article-recent-commenters">
      {commenters.map((author) => {
        const avatar = author.avatarUrl ? resolveApiUrl(author.avatarUrl) : null;
        return (
          <span className="article-recent-avatar" key={author.id} title={author.nickname}>
            {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
          </span>
        );
      })}
    </span>
  );
}

export function ArticleCard({
  article,
  taxonomyPlacement = "meta",
}: {
  article: Article;
  taxonomyPlacement?: "meta" | "after-stats";
}) {
  return (
    <Link className={`article-card${article.isPinned ? " is-pinned" : ""}`} href={`/articles/${article.slug}`}>
      <ArticlePinBadge isPinned={article.isPinned} />
      <div className="article-card-main">
        <h2 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h2>
        <div className="article-card-meta">
          <ArticleAuthorLine author={article.author} />
          <span className="article-card-date">{formatArticleDate(article.publishedAt)}</span>
          {taxonomyPlacement === "meta" ? <ArticleTaxonomy article={article} /> : null}
        </div>
      </div>
      <div className="article-card-aside">
        <RecentCommenters article={article} />
        <ArticleStats article={article} compact />
        {taxonomyPlacement === "after-stats" ? <ArticleTaxonomy article={article} /> : null}
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
