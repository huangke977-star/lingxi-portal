"use client";

import Link from "next/link";
import { PenLine, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";
import {
  ArticleCenterSummary,
  ArticleMineSummary,
  getPublicArticleCenterSummary,
  getMyArticleSummary,
  getVisibleArticleCenterSummary,
} from "@/lib/article-api";
import type { ArticleStatus } from "@/lib/article-api";
import type { AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { isSiteManager } from "@/lib/user-permissions";

export type ArticleCenterSection = "discover" | "subscriptions" | "resources" | "collections" | "topics" | "mine" | "reading" | "manage";

const sections: Array<{ id: Exclude<ArticleCenterSection, "manage">; href: string; labelKey: "discover.discover" | "discover.subscriptions" | "discover.resources" | "discover.collections" | "discover.topics" | "discover.myWriting" | "discover.myReading"; protected?: boolean; count?: "discover" | "subscriptions" | "mine" }> = [
  { id: "discover", href: "/articles", labelKey: "discover.discover", count: "discover" },
  { id: "subscriptions", href: "/articles/subscriptions", labelKey: "discover.subscriptions", protected: true, count: "subscriptions" },
  { id: "resources", href: "/articles/resources", labelKey: "discover.resources" },
  { id: "collections", href: "/articles/collections", labelKey: "discover.collections", protected: true },
  { id: "topics", href: "/topics", labelKey: "discover.topics" },
  { id: "mine", href: "/articles/mine", labelKey: "discover.myWriting", protected: true, count: "mine" },
  { id: "reading", href: "/articles/reading", labelKey: "discover.myReading", protected: true },
];

const emptySummary: ArticleCenterSummary = {
  discover: 0,
  subscriptions: 0,
  mine: 0,
  favorites: 0,
  liked: 0,
  readLater: 0,
  history: 0,
  manage: 0,
};

export function ArticleCenterNav({
  active,
  user,
  isLoggedIn,
  showWrite = true,
}: {
  active: ArticleCenterSection;
  user?: AuthUser | null;
  isLoggedIn: boolean;
  showWrite?: boolean;
}) {
  const { locale, t } = useLanguage();
  const [summary, setSummary] = useState<ArticleCenterSummary>(emptySummary);
  const canManage = isSiteManager(user);
  const protectedHref = (href: string) => isLoggedIn
    ? localizedPath(href, locale)
    : `${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(href, locale))}`;

  useEffect(() => {
    let activeRequest = true;
    const token = isLoggedIn ? readAccessToken() : null;
    const request = token
      ? getVisibleArticleCenterSummary(token)
      : getPublicArticleCenterSummary();

    request
      .then((result) => {
        if (activeRequest) setSummary(result);
      })
      .catch(async () => {
        if (!activeRequest || !token) return;
        try {
          const publicSummary = await getPublicArticleCenterSummary();
          if (activeRequest) setSummary(publicSummary);
        } catch {
          // Counts are supplementary navigation data; the page remains usable without them.
        }
      });

    return () => { activeRequest = false; };
  }, [isLoggedIn, user?.id]);

  return (
    <div className="article-center-nav-wrap">
      <nav aria-label={t("article.centerNav")} className="article-center-nav">
        {sections.map((section) => (
          <Link
            aria-current={active === section.id ? "page" : undefined}
            className={active === section.id ? "active" : undefined}
            href={section.protected ? protectedHref(section.href) : localizedPath(section.href, locale)}
            key={section.id}
          >
            {t(section.labelKey)}{section.count ? <span className="article-nav-count">{summary[section.count]}</span> : null}
          </Link>
        ))}
        {canManage ? (
          <Link
            aria-current={active === "manage" ? "page" : undefined}
            className={`article-manage-tab${active === "manage" ? " active" : ""}`}
            href={localizedPath("/articles/manage", locale)}
          >
            {t("discover.manage")}<span className="article-nav-count">{summary.manage}</span>
          </Link>
        ) : null}
      </nav>
      {showWrite ? (
        <Link className="article-write-link" href={protectedHref("/articles/write")}>
          <PenLine aria-hidden="true" size={16} />
          {t("discover.write")}
        </Link>
      ) : null}
    </div>
  );
}

export type ArticleMineTab = "all" | ArticleStatus | "templates";

const mineStatusValues: ArticleStatus[] = ["draft", "published", "unpublished", "blocked", "deleted"];

export function ArticleMineSecondaryNav({
  active,
  onCreateTemplate,
  summary,
  search = "",
}: {
  active: ArticleMineTab;
  onCreateTemplate?: () => void;
  summary?: ArticleMineSummary;
  search?: string;
}) {
  const { locale, phrase } = useLanguage();
  const [loadedSummary, setLoadedSummary] = useState<ArticleMineSummary | null>(null);
  const currentSummary = summary ?? loadedSummary ?? { total: 0, draft: 0, published: 0, unpublished: 0, blocked: 0, deleted: 0 };

  useEffect(() => {
    if (summary) return;
    const token = readAccessToken();
    if (!token) return;
    getMyArticleSummary(token).then(setLoadedSummary).catch(() => {
      // The secondary navigation remains usable when counts are unavailable.
    });
  }, [summary]);

  const statusLabel = (value: "all" | ArticleStatus) => value === "all"
    ? phrase("全部", "All")
    : value === "draft"
      ? phrase("草稿", "Draft")
      : value === "published"
        ? phrase("已发布", "Published")
        : value === "unpublished"
          ? phrase("已下架", "Unpublished")
          : value === "blocked"
            ? phrase("受限", "Restricted")
            : phrase("回收站", "Recycle bin");
  const hrefFor = (value: "all" | ArticleStatus) => {
    const params = new URLSearchParams();
    if (value !== "all") params.set("status", value);
    if (search.trim()) params.set("q", search.trim());
    const query = params.toString();
    return `${localizedPath("/articles/mine", locale)}${query ? `?${query}` : ""}`;
  };
  const countFor = (value: "all" | ArticleStatus) => value === "all" ? currentSummary.total - currentSummary.deleted : currentSummary[value];

  return (
    <nav aria-label={phrase("文章状态", "Article status")} className="article-status-tabs article-center-secondary-tabs">
      <Link aria-current={active === "all" ? "page" : undefined} className={active === "all" ? "active" : undefined} href={hrefFor("all")}>
        {statusLabel("all")}<span>{countFor("all")}</span>
      </Link>
      {mineStatusValues.map((value) => (
        <Link aria-current={active === value ? "page" : undefined} className={active === value ? "active" : undefined} href={hrefFor(value)} key={value}>
          {statusLabel(value)}<span>{countFor(value)}</span>
        </Link>
      ))}
      <Link aria-current={active === "templates" ? "page" : undefined} className={active === "templates" ? "active" : undefined} href={localizedPath("/articles/templates", locale)}>
        {phrase("模板", "Templates")}
      </Link>
      {onCreateTemplate ? <button aria-label={phrase("创建模板", "Create template")} className="article-template-create-action" onClick={onCreateTemplate} title={phrase("创建模板", "Create template")} type="button"><Plus aria-hidden="true" size={17} /></button> : null}
    </nav>
  );
}
