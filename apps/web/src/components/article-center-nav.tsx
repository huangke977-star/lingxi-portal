"use client";

import Link from "next/link";
import { PenLine } from "lucide-react";
import type { AuthUser } from "@/lib/auth-api";

export type ArticleCenterSection = "discover" | "mine" | "favorites" | "liked" | "manage";

const sections: Array<{ id: Exclude<ArticleCenterSection, "manage">; href: string; label: string; protected?: boolean }> = [
  { id: "discover", href: "/articles", label: "发现" },
  { id: "mine", href: "/articles/mine", label: "我的创作", protected: true },
  { id: "favorites", href: "/articles/favorites", label: "收藏", protected: true },
  { id: "liked", href: "/articles/liked", label: "赞过", protected: true },
];

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
  const canManage = Boolean(user?.isSuperAdmin || (user?.role.level ?? 0) >= 90);
  const protectedHref = (href: string) => isLoggedIn
    ? href
    : `/login?from=${encodeURIComponent(href)}`;

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
            {section.label}
          </Link>
        ))}
        {canManage ? (
          <Link
            aria-current={active === "manage" ? "page" : undefined}
            className={`article-manage-tab${active === "manage" ? " active" : ""}`}
            href="/articles/manage"
          >
            管理
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
