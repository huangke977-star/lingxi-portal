"use client";

/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { isAuthExpiredError } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
} from "@/lib/auth-storage";
import {
  listPortalContent,
  PortalCategory,
  PortalCategoryKind,
  PortalEntry,
  portalEntryMarker,
} from "@/lib/portal-api";

interface PortalContentListProps {
  kinds: PortalCategoryKind[];
  emptyMessage: string;
}

const KIND_LABEL: Record<PortalCategoryKind, string> = {
  navigation: "导航",
  tool: "工具",
  server: "超级管理员",
  custom_page: "页面",
};

export function PortalContentList({
  kinds,
  emptyMessage,
}: PortalContentListProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<PortalCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadContent() {
      setIsLoading(true);
      setError("");
      const token = readAccessToken();
      try {
        const content = await listPortalContent(kinds, token);
        if (isMounted) {
          setCategories(content.categories);
        }
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取门户内容。",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadContent();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, loadContent);
    return () => {
      isMounted = false;
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, loadContent);
    };
  }, [kinds, router]);

  if (isLoading) {
    return (
      <div className="status-row compact-status-row">
        <span className="status">正在读取内容</span>
      </div>
    );
  }

  return (
    <>
      {categories.length ? (
        <div className="portal-category-list">
          {categories.map((category) => (
            <section className="portal-category-section" key={category.id}>
              <div className="portal-category-heading">
                <div>
                  <span className="section-label">
                    {KIND_LABEL[category.kind]}
                  </span>
                  <h2>{category.name}</h2>
                </div>
                {category.description ? <p>{category.description}</p> : null}
              </div>
              <div className="entry-list card-grid">
                {category.entries.map((entry) => (
                  <PortalEntryItem
                    entry={entry}
                    kind={category.kind}
                    key={entry.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="portal-empty-state">
          <strong>暂时没有可见内容</strong>
          <p>{emptyMessage}</p>
        </div>
      )}
      <AppToast
        duration={4200}
        message={error}
        onDismiss={() => setError("")}
        tone="error"
      />
    </>
  );
}

function PortalEntryItem({
  entry,
  kind,
}: {
  entry: PortalEntry;
  kind: PortalCategoryKind;
}) {
  const content = (
    <>
      <span className="entry-marker portal-entry-marker">
        {entry.iconPath ? (
          <img alt="" src={entry.iconPath} />
        ) : (
          portalEntryMarker(entry.title)
        )}
      </span>
      <span className="entry-main">
        <strong>{entry.title}</strong>
        <span>{entry.description || "暂无说明"}</span>
      </span>
      <span className="entry-meta">{entryMeta(entry, kind)}</span>
    </>
  );

  if (!entry.url) {
    return <div className="entry-item muted">{content}</div>;
  }

  return (
    <a
      className="entry-item"
      href={entry.url}
      rel={entry.openInNewTab ? "noreferrer" : undefined}
      target={entry.openInNewTab ? "_blank" : undefined}
    >
      {content}
    </a>
  );
}

function entryMeta(entry: PortalEntry, kind: PortalCategoryKind): string {
  if (kind === "server") {
    return "超级管理员";
  }
  if (!entry.url) {
    return "待接入";
  }
  if (entry.visibility === "public") {
    return "公开";
  }
  if (entry.visibility === "authenticated") {
    return "登录可见";
  }
  return entry.allowedRoles.map((role) => role.name).join(" · ");
}
