"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Bookmark, Coins, Eye, EyeOff, Heart, LockKeyhole, MessageCircle, Pin, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { memo, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Article, ArticleAuthor, ArticleContentFormat, ArticleContentSegment } from "@/lib/article-api";
import { requestBlob, resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { getAvatarFallbackText } from "@/lib/user-display";
import { PublicProfilePopover } from "@/components/public-profile-popover";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
import { useLanguage } from "@/components/language-provider";
import { localizedPath, type Locale } from "@/lib/i18n";

const defaultTaxonomyTranslations: Record<string, string> = {
  "随笔": "Essay",
  "技术": "Technology",
  "服务器": "Servers",
  "工具": "Tools",
  "资源": "Resources",
  "教程": "Tutorials",
  "生活": "Life",
  "公告": "Announcements",
  "开发": "Development",
  "前端": "Frontend",
  "后端": "Backend",
  "数据库": "Databases",
  "运维": "Operations",
  "网络": "Networking",
  "经验": "Experience",
};

// Built-in taxonomy values are stored in Chinese for compatibility. Translate only
// those defaults at render time; administrator-configured taxonomy remains user data.
export function displayArticleTaxonomy(value: string, locale: Locale): string {
  return locale === "en-US" ? defaultTaxonomyTranslations[value] ?? value : value;
}

export function formatArticleDate(value: string | null, locale: Locale = "zh-CN"): string {
  if (!value) return locale === "en-US" ? "Not published" : "尚未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "en-US" ? "Unknown time" : "时间未知";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ArticleAuthorLine({ author, interactive = false }: { author: ArticleAuthor; interactive?: boolean }) {
  const { locale } = useLanguage();
  const avatar = author.avatarUrl ? resolveApiUrl(author.avatarUrl) : null;
  return (
    <span className="article-author-line">
      {interactive ? <PublicProfilePopover author={author} /> : <span className="identity-badged-avatar">
        <span className="article-author-avatar">
          {avatar ? <img alt="" src={avatar} /> : getAvatarFallbackText({ nickname: author.nickname, username: author.username })}
        </span>
        <AvatarManagementBadge user={author} />
      </span>}
      <Link className="article-author-profile-link" href={localizedPath(`/users/${encodeURIComponent(author.username)}`, locale)} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}>{author.nickname}</Link>
    </span>
  );
}

export function ArticleStats({ article, compact = false }: { article: Article; compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <span className={`article-stats${compact ? " compact" : ""}`}>
      <span title={t("article.views")}><Eye aria-hidden="true" size={compact ? 13 : 15} />{article.viewCount}</span>
      <span title={t("article.likes")}><Heart aria-hidden="true" size={compact ? 13 : 15} />{article.likeCount}</span>
      <span title={t("article.comments")}><MessageCircle aria-hidden="true" size={compact ? 13 : 15} />{article.commentCount}</span>
      <span title={t("article.favorites")}><Bookmark aria-hidden="true" size={compact ? 13 : 15} />{article.favoriteCount}</span>
    </span>
  );
}

export function ArticlePinBadge({ isPinned }: { isPinned: boolean }) {
  const { t } = useLanguage();
  if (!isPinned) return null;
  return (
    <span aria-label={t("article.pinned")} className="article-pin-corner" role="img" title={t("article.pinned")}>
      <Pin aria-hidden="true" fill="currentColor" size={13} />
    </span>
  );
}

export function ArticleTaxonomy({ article, limit = 3 }: { article: Article; limit?: number }) {
  const { locale, t } = useLanguage();
  const visibleTags = article.tags.slice(0, limit);
  const hiddenCount = Math.max(0, article.tags.length - visibleTags.length);
  return (
    <span className="article-taxonomy">
      <span className="article-category">{article.category ? displayArticleTaxonomy(article.category, locale) : t("article.defaultCategory")}</span>
      {article.resource.enabled ? <span className="article-resource-chip" title={`${article.resource.blocks.length} ${t("article.resource")}`}><Coins aria-hidden="true" size={12} />{t("article.resource")}</span> : null}
      {visibleTags.map((tag) => <span className="article-tag-chip" key={tag}>#{displayArticleTaxonomy(tag, locale)}</span>)}
      {hiddenCount ? <span className="article-tag-more">+{hiddenCount}</span> : null}
      {(article.collections ?? []).slice(0, 2).map((collection) => (
        <Link className="article-group-chip collection" href={localizedPath(collection.href, locale)} key={`collection-${collection.id}`} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}>{collection.label}</Link>
      ))}
      {(article.topics ?? []).slice(0, 2).map((topic) => (
        <Link className="article-group-chip topic" href={localizedPath(topic.href, locale)} key={`topic-${topic.id}`} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}>{topic.label}</Link>
      ))}
    </span>
  );
}

export function RecentCommenters({ article }: { article: Article }) {
  const { t } = useLanguage();
  const commenters = article.recentCommenters.filter(
    (author, index, authors) => authors.findIndex((candidate) => candidate.id === author.id) === index,
  ).slice(0, 5);
  if (!commenters.length) return null;
  return (
    <span aria-label={t("article.recentCommenters")} className="article-recent-commenters">
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
  onNotInterested,
}: {
  article: Article;
  href?: string;
  metaAccessory?: ReactNode;
  taxonomyPlacement?: "meta" | "after-stats";
  onNotInterested?: (article: Article) => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <article className="article-card">
      <Link aria-label={t("article.read", { title: article.title })} className="article-card-link" href={localizedPath(href ?? `/articles/${article.slug}`, locale)} />
      <ArticlePinBadge isPinned={article.isPinned} />
      <div className="article-card-main">
        <h2 style={article.titleColor ? { color: article.titleColor } : undefined}>{article.title}</h2>
        <div className="article-card-meta">
          <ArticleAuthorLine author={article.author} interactive />
          <span className="article-card-date">{formatArticleDate(article.publishedAt, locale)}</span>
          {taxonomyPlacement === "meta" ? <ArticleTaxonomy article={article} /> : null}
          {metaAccessory ? <span className="article-card-meta-accessory">{metaAccessory}</span> : null}
        </div>
      </div>
      <div className="article-card-aside">
        <RecentCommenters article={article} />
        <ArticleStats article={article} compact />
        {onNotInterested ? <button aria-label={t("discover.notInterested")} className="article-recommendation-feedback" onClick={() => onNotInterested(article)} title={t("discover.notInterested")} type="button"><EyeOff aria-hidden="true" size={15} /></button> : null}
        {taxonomyPlacement === "after-stats" ? <ArticleTaxonomy article={article} /> : null}
      </div>
    </article>
  );
}

export const ArticleBody = memo(function ArticleBody({
  content,
  contentSegments,
  contentFormat: requestedFormat,
  pendingImageUrls,
  onRedeemResource,
}: {
  content: string;
  contentFormat?: ArticleContentFormat;
  contentSegments?: ArticleContentSegment[];
  pendingImageUrls?: Record<string, string>;
  onRedeemResource?: (blockKey: string) => void;
}) {
  const { t } = useLanguage();
  const [previewImage, setPreviewImage] = useState<{ alt: string; src: string } | null>(null);
  const contentFormat = requestedFormat ?? (looksLikeHtml(content) ? "html" : "markdown");
  const segments = contentSegments?.length ? contentSegments : parseArticleContentForDisplay(content, contentFormat);
  const attachmentImagePaths = useMemo(() => Array.from(new Set(
    segments.flatMap((segment) => extractArticleImageAttachmentPaths(segment.content ?? "")),
  )), [segments]);
  const attachmentImageUrls = useArticleAttachmentImageUrls(attachmentImagePaths);
  return (
    <div className="article-body">
      {segments.map((segment, index) => segment.type === "resource" ? (
        segment.unlocked && segment.content ? (
          contentFormat === "html" ? <HtmlSegment attachmentImageUrls={attachmentImageUrls} content={segment.content} key={segment.key ?? `resource-${index}`} onPreviewImage={setPreviewImage} pendingImageUrls={pendingImageUrls} /> : <MarkdownSegment attachmentImageUrls={attachmentImageUrls} content={segment.content} key={segment.key ?? `resource-${index}`} onPreviewImage={setPreviewImage} pendingImageUrls={pendingImageUrls} />
        ) : (
          <section className="article-resource-lock" key={segment.key ?? `resource-${index}`}>
            <LockKeyhole aria-hidden="true" size={24} />
            <div><span>{t("article.resource")}</span><strong>{t("article.resourceUnlock", { count: segment.pointCost ?? 0 })}</strong><p>{t("article.resourceNote")}</p></div>
            {segment.key && onRedeemResource ? <button onClick={() => onRedeemResource(segment.key!)} type="button"><Coins aria-hidden="true" size={16} />{t("article.redeem")}</button> : null}
          </section>
        )
      ) : segment.type === "html" ? <HtmlSegment attachmentImageUrls={attachmentImageUrls} content={segment.content ?? ""} key={`html-${index}`} onPreviewImage={setPreviewImage} pendingImageUrls={pendingImageUrls} /> : <MarkdownSegment attachmentImageUrls={attachmentImageUrls} content={segment.content ?? ""} key={`markdown-${index}`} onPreviewImage={setPreviewImage} pendingImageUrls={pendingImageUrls} />)}
      {previewImage ? <ArticleImagePreview alt={previewImage.alt} onClose={() => setPreviewImage(null)} src={previewImage.src} /> : null}
    </div>
  );
});

function MarkdownSegment({ attachmentImageUrls, content, onPreviewImage, pendingImageUrls }: {
  attachmentImageUrls: Record<string, string>;
  content: string;
  onPreviewImage: (image: { alt: string; src: string }) => void;
  pendingImageUrls?: Record<string, string>;
}) {
  const { phrase } = useLanguage();
  return <ReactMarkdown
    components={{
      a: ({ href, children }) => {
        const attachmentPath = getArticleAttachmentPath(href);
        if (attachmentPath) return <ArticleAttachmentLink fileName={articleLinkText(children)} path={attachmentPath}>{children}</ArticleAttachmentLink>;
        return safeArticleUrl(href)
          ? <a href={href} rel="noreferrer" target="_blank">{children}</a>
          : <span>{children}</span>;
      },
      img: ({ alt, src }) => {
        if (!safeArticleUrl(src)) return null;
        const resolvedSource = resolveArticleImageUrl(src, pendingImageUrls, attachmentImageUrls);
        return <button aria-label={alt || phrase("预览图片", "Preview image")} className="article-body-image-trigger" onClick={() => onPreviewImage({ alt: alt ?? "", src: resolvedSource })} type="button"><img alt={alt ?? ""} className="article-body-image" src={resolvedSource} /></button>;
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

function HtmlSegment({ attachmentImageUrls, content, onPreviewImage, pendingImageUrls }: {
  attachmentImageUrls: Record<string, string>;
  content: string;
  onPreviewImage: (image: { alt: string; src: string }) => void;
  pendingImageUrls?: Record<string, string>;
}) {
  const resolvedPendingContent = Object.entries(pendingImageUrls ?? {}).reduce(
    (current, [marker, url]) => current.replaceAll(marker, url),
    content,
  );
  const resolvedContent = resolveHtmlArticleAttachmentUrls(resolvedPendingContent, attachmentImageUrls);
  return <div className="article-html-segment" dangerouslySetInnerHTML={{ __html: resolvedContent }} onClick={(event) => {
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest("img");
    if (image instanceof HTMLImageElement) {
      onPreviewImage({ alt: image.alt, src: image.currentSrc || image.src });
      return;
    }
    const anchor = target?.closest("a");
    const attachmentPath = getArticleAttachmentPath(anchor?.getAttribute("href"));
    if (!attachmentPath) return;
    event.preventDefault();
    void downloadArticleAttachment(attachmentPath, anchor?.textContent ?? "attachment");
  }} />;
}

function ArticleAttachmentLink({ children, fileName, path }: { children: ReactNode; fileName: string; path: string }) {
  return <a download href={resolveApiUrl(path)} onClick={(event) => { event.preventDefault(); void downloadArticleAttachment(path, fileName); }}>{children}</a>;
}

function ArticleImagePreview({ alt, onClose, src }: { alt: string; onClose: () => void; src: string }) {
  const { t } = useLanguage();
  return <div className="chat-attachment-preview article-image-preview" onClick={onClose} role="presentation"><button aria-label={t("common.close")} onClick={onClose} title={t("common.close")} type="button"><X aria-hidden="true" size={22} /></button><img alt={alt} onClick={(event) => event.stopPropagation()} src={src} /></div>;
}

function useArticleAttachmentImageUrls(paths: string[]): Record<string, string> {
  const pathKey = paths.join("\n");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    const token = readAccessToken();
    if (!paths.length) {
      return () => undefined;
    }
    void Promise.all(paths.map(async (path) => {
      try {
        const blob = await requestBlob(path, token ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" } : { cache: "no-store" });
        const url = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(url);
          return null;
        }
        createdUrls.push(url);
        return [path, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  // The joined value is stable across renders while the effective attachment set is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);
  return urls;
}

function extractArticleImageAttachmentPaths(content: string): string[] {
  const paths = new Set<string>();
  const add = (value: string | undefined) => {
    const path = getArticleAttachmentPath(value);
    if (path) paths.add(path);
  };
  for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) add(match[1]);
  for (const match of content.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) add(match[1]);
  return Array.from(paths);
}

function getArticleAttachmentPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(?:https?:\/\/[^/]+)?\/?(?:api\/)?articles\/attachments\/(\d+)\/(download|thumbnail)([?#][^\s]*)?$/i.exec(value.trim());
  return match ? `/articles/attachments/${match[1]}/${match[2]}${match[3] ?? ""}` : null;
}

function resolveArticleImageUrl(source: string, pendingImageUrls: Record<string, string> | undefined, attachmentImageUrls: Record<string, string>): string {
  if (pendingImageUrls?.[source]) return pendingImageUrls[source];
  const attachmentPath = getArticleAttachmentPath(source);
  return attachmentPath ? attachmentImageUrls[attachmentPath] ?? resolveApiUrl(attachmentPath) : resolveApiUrl(source);
}

function resolveHtmlArticleAttachmentUrls(content: string, attachmentImageUrls: Record<string, string>): string {
  return content.replace(/\b(src|href)=(["'])([^"']+)\2/gi, (raw, attribute: string, quote: string, value: string) => {
    const attachmentPath = getArticleAttachmentPath(value);
    if (!attachmentPath) return raw;
    const resolved = attribute.toLowerCase() === "src"
      ? attachmentImageUrls[attachmentPath] ?? resolveApiUrl(attachmentPath)
      : resolveApiUrl(attachmentPath);
    return `${attribute}=${quote}${resolved}${quote}`;
  });
}

async function downloadArticleAttachment(path: string, fileName: string): Promise<void> {
  const token = readAccessToken();
  try {
    const blob = await requestBlob(path, token ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" } : { cache: "no-store" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.trim() || "attachment";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.location.assign(resolveApiUrl(path));
  }
}

function articleLinkText(children: ReactNode): string {
  return typeof children === "string" ? children : "attachment";
}

function parseArticleContentForDisplay(source: string, format: ArticleContentFormat): ArticleContentSegment[] {
  if (format === "html") return parseHtmlContentForDisplay(source);
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

function parseHtmlContentForDisplay(source: string): ArticleContentSegment[] {
  const segments: ArticleContentSegment[] = [];
  const pattern = /<resource-block\b([^>]*)>([\s\S]*?)<\/resource-block>/gi;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const normal = source.slice(cursor, index).trim();
    if (normal) segments.push({ type: "html", content: normal });
    const pointCost = Number(/data-points=["'](\d+)["']/i.exec(match[1] ?? "")?.[1] ?? 0);
    const content = (match[2] ?? "").trim();
    if (pointCost > 0 && content) segments.push({ type: "resource", content, pointCost, unlocked: true, key: `preview-resource-${segments.length}` });
    cursor = index + match[0].length;
  }
  const tail = source.slice(cursor).trim();
  if (tail) segments.push({ type: "html", content: tail });
  return segments.length ? segments : [{ type: "html", content: source }];
}

function safeArticleUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/") || /^https?:\/\//i.test(value));
}

function looksLikeHtml(value: string): boolean {
  return /<(?:p|h[1-6]|ul|ol|blockquote|pre|resource-block)\b/i.test(value.trim());
}
