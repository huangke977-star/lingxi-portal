"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bookmark, Eye, Heart, MessageCircle, Pin } from "lucide-react";
import type { Article, ArticleAuthor } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { getAvatarFallbackText } from "@/lib/user-display";

export function formatArticleDate(value: string | null): string {
  if (!value) return "尚未发布";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
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

export function ArticleBody({ content }: { content: string }) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  function flushCode() {
    if (!codeLines.length) return;
    blocks.push(<pre className="article-code" key={`code-${blocks.length}`}><code>{codeLines.join("\n")}</code></pre>);
    codeLines = [];
  }

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (inCode) flushCode();
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<div className="article-line-space" key={`space-${index}`} />);
      return;
    }
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image && safeArticleUrl(image[2])) {
      blocks.push(<figure className="article-body-image" key={`image-${index}`}><img alt={image[1]} src={resolveApiUrl(image[2])} /><figcaption>{image[1]}</figcaption></figure>);
      return;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4";
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2])}</Heading>);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      blocks.push(<p className="article-list-line" key={`list-${index}`}><span>•</span>{renderInline(trimmed.replace(/^[-*]\s+/, ""))}</p>);
      return;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(trimmed)}</p>);
  });
  if (inCode) flushCode();
  return <div className="article-body">{blocks}</div>;
}

function renderInline(value: string): React.ReactNode {
  const parts = value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && safeArticleUrl(link[2])) return <a href={link[2]} key={index} rel="noreferrer" target="_blank">{link[1]}</a>;
    return <span key={index}>{part}</span>;
  });
}

function safeArticleUrl(value: string): boolean {
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}
