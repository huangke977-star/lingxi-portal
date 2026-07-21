"use client";

import Link from "next/link";
import { PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ArticleCenterSummary,
  getPublicArticleCenterSummary,
  getVisibleArticleCenterSummary,
} from "@/lib/article-api";
import type { AuthUser } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";

export type ArticleCenterSection = "discover" | "mine" | "favorites" | "liked" | "manage";

const sections: Array<{ id: Exclude<ArticleCenterSection, "manage">; href: string; label: string; protected?: boolean }> = [
  { id: "discover", href: "/articles", label: "发现" },
  { id: "mine", href: "/articles/mine", label: "我的创作", protected: true },
  { id: "favorites", href: "/articles/favorites", label: "收藏", protected: true },
  { id: "liked", href: "/articles/liked", label: "赞过", protected: true },
];

const emptySummary: ArticleCenterSummary = {
  discover: 0,
  mine: 0,
  favorites: 0,
  liked: 0,
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
  const [summary, setSummary] = useState<ArticleCenterSummary>(emptySummary);
  const canManage = Boolean(user?.isSuperAdmin || (user?.role.level ?? 0) >= 90);
  const protectedHref = (href: string) => isLoggedIn
    ? href
    : `/login?from=${encodeURIComponent(href)}`;

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
      <nav aria-label="文章中心" className="article-center-nav">
        {sections.map((section) => (
          <Link
            aria-current={active === section.id ? "page" : undefined}
            className={active === section.id ? "active" : undefined}
            href={section.protected ? protectedHref(section.href) : section.href}
            key={section.id}
          >
            {section.label}<span className="article-nav-count">{summary[section.id]}</span>
          </Link>
        ))}
        {canManage ? (
          <Link
            aria-current={active === "manage" ? "page" : undefined}
            className={`article-manage-tab${active === "manage" ? " active" : ""}`}
            href="/articles/manage"
          >
            管理<span className="article-nav-count">{summary.manage}</span>
          </Link>
        ) : null}
      </nav>
      {showWrite ? (
        <Link className="article-write-link" href={protectedHref("/articles/write")}>
          <PenLine aria-hidden="true" size={16} />
          写文章
        </Link>
      ) : null}
    </div>
  );
}
