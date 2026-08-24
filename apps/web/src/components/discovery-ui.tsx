"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bookmark, Eye, Heart, MessageCircle } from "lucide-react";
import type { DiscoveryArticle } from "@/lib/discovery-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { formatArticleDate } from "@/components/article-ui";
import { getAvatarFallbackText } from "@/lib/user-display";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";

export function DiscoveryArticleRow({
  article,
  unread = false,
  onOpen,
}: {
  article: DiscoveryArticle;
  unread?: boolean;
  onOpen?: () => void;
}) {
  const { locale, t } = useLanguage();
  const avatar = article.author.avatarUrl ? resolveApiUrl(article.author.avatarUrl) : null;
  return (
    <article className={`discovery-article-row${unread ? " unread" : ""}`}>
      <Link aria-label={t("article.read", { title: article.title })} className="discovery-row-link" href={localizedPath(`/articles/${article.slug}`, locale)} onClick={onOpen} />
      <span className="discovery-unread-dot" title={unread ? t("article.unread") : t("article.readState")} />
      <span className="discovery-author-avatar">
        {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText(article.author)}
      </span>
      <div className="discovery-row-main">
        <h2 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h2>
        <div className="discovery-row-meta">
          <Link href={localizedPath(`/users/${encodeURIComponent(article.author.username)}`, locale)}>{article.author.nickname}</Link>
          <span>{formatArticleDate(article.publishedAt, locale)}</span>
          <span className="article-category">{article.category || t("article.defaultCategory")}</span>
          {article.tags.slice(0, 2).map((tag) => <span className="article-tag-chip" key={tag}>#{tag}</span>)}
          {article.collections.slice(0, 2).map((item) => <Link className="article-group-chip collection" href={item.href} key={`c-${item.id}`}>{item.label}</Link>)}
          {article.topics.slice(0, 2).map((item) => <Link className="article-group-chip topic" href={item.href} key={`t-${item.id}`}>{item.label}</Link>)}
        </div>
      </div>
      <span className="discovery-row-stats">
        <span title={t("article.views")}><Eye aria-hidden="true" size={14} />{article.viewCount}</span>
        <span title={t("article.likes")}><Heart aria-hidden="true" size={14} />{article.likeCount}</span>
        <span title={t("article.comments")}><MessageCircle aria-hidden="true" size={14} />{article.commentCount}</span>
        <span title={t("article.favorites")}><Bookmark aria-hidden="true" size={14} />{article.favoriteCount}</span>
      </span>
    </article>
  );
}
