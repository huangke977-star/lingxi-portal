"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bookmark, Coins, Eye, Heart, LockKeyhole, MessageCircle, Pin } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Article, ArticleAuthor, ArticleContentSegment } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { getAvatarFallbackText } from "@/lib/user-display";
import { PublicProfilePopover } from "@/components/public-profile-popover";
import { AvatarManagementBadge } from "@/components/user-identity-badges";

export function formatArticleDate(value: string | null): string {
  if (!value) return "尚未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ArticleAuthorLine({ author, interactive = false }: { author: ArticleAuthor; interactive?: boolean }) {
  const avatar = author.avatarUrl ? resolveApiUrl(author.avatarUrl) : null;
  return (
    <span className="article-author-line">
      {interactive ? <PublicProfilePopover author={author} /> : <span className="identity-badged-avatar">
        <span className="article-author-avatar">
          {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
        </span>
        <AvatarManagementBadge user={author} />
      </span>}
      <Link className="article-author-profile-link" href={`/users/${encodeURIComponent(author.username)}`} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}>{author.nickname}</Link>
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
      {article.resource.enabled ? <span className="article-resource-chip" title={`${article.resource.blocks.length} 个积分资源区域`}><Coins aria-hidden="true" size={12} />资源</span> : null}
      {visibleTags.map((tag) => <span className="article-tag-chip" key={tag}>#{tag}</span>)}
      {hiddenCount ? <span className="article-tag-more">+{hiddenCount}</span> : null}
      {(article.collections ?? []).slice(0, 2).map((collection) => (
        <Link className="article-group-chip collection" href={collection.href} key={`collection-${collection.id}`} onClick={(event) => event.stopPropagation()}>{collection.label}</Link>
      ))}
      {(article.topics ?? []).slice(0, 2).map((topic) => (
        <Link className="article-group-chip topic" href={topic.href} key={`topic-${topic.id}`} onClick={(event) => event.stopPropagation()}>{topic.label}</Link>
      ))}
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
  href,
  metaAccessory,
  taxonomyPlacement = "meta",
}: {
  article: Article;
  href?: string;
  metaAccessory?: ReactNode;
  taxonomyPlacement?: "meta" | "after-stats";
}) {
  return (
    <article className="article-card">
      <Link aria-label={`阅读 ${article.title}`} className="article-card-link" href={href ?? `/articles/${article.slug}`} />
      <ArticlePinBadge isPinned={article.isPinned} />
      <div className="article-card-main">
        <h2 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h2>
        <div className="article-card-meta">
          <ArticleAuthorLine author={article.author} interactive />
          <span className="article-card-date">{formatArticleDate(article.publishedAt)}</span>
          {taxonomyPlacement === "meta" ? <ArticleTaxonomy article={article} /> : null}
          {metaAccessory ? <span className="article-card-meta-accessory">{metaAccessory}</span> : null}
        </div>
      </div>
      <div className="article-card-aside">
        <RecentCommenters article={article} />
        <ArticleStats article={article} compact />
        {taxonomyPlacement === "after-stats" ? <ArticleTaxonomy article={article} /> : null}
      </div>
    </article>
  );
}

export const ArticleBody = memo(function ArticleBody({
  content,
  contentSegments,
  pendingImageUrls,
  onRedeemResource,
}: {
  content: string;
  contentSegments?: ArticleContentSegment[];
  pendingImageUrls?: Record<string, string>;
  onRedeemResource?: (blockKey: string) => void;
}) {
  const segments = contentSegments?.length ? contentSegments : parseArticleContentForDisplay(content);
  return (
    <div className="article-body">
      {segments.map((segment, index) => segment.type === "resource" ? (
        segment.unlocked && segment.content ? (
          <MarkdownSegment content={segment.content} key={segment.key ?? `resource-${index}`} pendingImageUrls={pendingImageUrls} />
        ) : (
          <section className="article-resource-lock" key={segment.key ?? `resource-${index}`}>
            <LockKeyhole aria-hidden="true" size={24} />
            <div><span>积分资源</span><strong>需要 {segment.pointCost ?? 0} 积分开启该区域内容</strong><p>兑换后永久解锁，积分将在 72 小时后入账作者账户。</p></div>
            {segment.key && onRedeemResource ? <button onClick={() => onRedeemResource(segment.key!)} type="button"><Coins aria-hidden="true" size={16} />兑换</button> : null}
          </section>
        )
      ) : <MarkdownSegment content={segment.content ?? ""} key={`markdown-${index}`} pendingImageUrls={pendingImageUrls} />)}
    </div>
  );
});

function MarkdownSegment({ content, pendingImageUrls }: { content: string; pendingImageUrls?: Record<string, string> }) {
  return <ReactMarkdown
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
  </ReactMarkdown>;
}

function parseArticleContentForDisplay(source: string): ArticleContentSegment[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const segments: ArticleContentSegment[] = [];
  let markdown: string[] = [];
  let resource: string[] | null = null;
  let pointCost = 0;
  const flushMarkdown = () => {
    const value = markdown.join("\n");
    if (value.trim()) segments.push({ type: "markdown", content: value });
    markdown = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const opening = /^:::resource\{points=(\d+)\}\s*$/.exec(trimmed);
    if (resource === null && opening) {
      flushMarkdown();
      resource = [];
      pointCost = Number(opening[1]);
      continue;
    }
    if (resource !== null) {
      if (/^:::\s*$/.test(trimmed)) {
        const value = resource.join("\n").trim();
        segments.push({ type: "resource", content: value, pointCost, unlocked: true, key: `preview-resource-${segments.length}` });
        resource = null;
        pointCost = 0;
      } else resource.push(line);
      continue;
    }
    markdown.push(line);
  }
  if (resource !== null) markdown.push(":::resource{points=" + pointCost + "}", ...resource);
  flushMarkdown();
  return segments.length ? segments : [{ type: "markdown", content: source }];
}

function safeArticleUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/") || /^https?:\/\//i.test(value));
}
