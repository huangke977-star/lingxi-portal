"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bookmark, Eye, Heart, MessageCircle } from "lucide-react";
import type { DiscoveryArticle } from "@/lib/discovery-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { formatArticleDate } from "@/components/article-ui";
import { getAvatarFallbackText } from "@/lib/user-display";

export function DiscoveryArticleRow({
  article,
  unread = false,
  onOpen,
}: {
  article: DiscoveryArticle;
  unread?: boolean;
  onOpen?: () => void;
}) {
  const avatar = article.author.avatarUrl ? resolveApiUrl(article.author.avatarUrl) : null;
  return (
    <article className={`discovery-article-row${unread ? " unread" : ""}`}>
      <Link aria-label={`阅读 ${article.title}`} className="discovery-row-link" href={`/articles/${article.slug}`} onClick={onOpen} />
      <span className="discovery-unread-dot" title={unread ? "未读" : "已读"} />
      <span className="discovery-author-avatar">
        {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(article.author)}
      </span>
      <div className="discovery-row-main">
        <h2 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h2>
        <div className="discovery-row-meta">
          <Link href={`/users/${encodeURIComponent(article.author.username)}`}>{article.author.nickname}</Link>
          <span>{formatArticleDate(article.publishedAt)}</span>
          <span className="article-category">{article.category || "随笔"}</span>
          {article.tags.slice(0, 2).map((tag) => <span className="article-tag-chip" key={tag}>#{tag}</span>)}
          {article.collections.slice(0, 2).map((item) => <Link className="article-group-chip collection" href={item.href} key={`c-${item.id}`}>{item.label}</Link>)}
          {article.topics.slice(0, 2).map((item) => <Link className="article-group-chip topic" href={item.href} key={`t-${item.id}`}>{item.label}</Link>)}
        </div>
      </div>
      <span className="discovery-row-stats">
        <span title="阅读"><Eye aria-hidden="true" size={14} />{article.viewCount}</span>
        <span title="点赞"><Heart aria-hidden="true" size={14} />{article.likeCount}</span>
        <span title="评论"><MessageCircle aria-hidden="true" size={14} />{article.commentCount}</span>
        <span title="收藏"><Bookmark aria-hidden="true" size={14} />{article.favoriteCount}</span>
      </span>
    </article>
  );
}
