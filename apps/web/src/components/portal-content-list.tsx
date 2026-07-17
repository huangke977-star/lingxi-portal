"use client";

/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
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
                  <h2>{category.name}</h2>
                </div>
                <div className="portal-category-heading-aside">
                  <span className="portal-category-count">
                    {category.entries.length} 个入口
                  </span>
                  {category.description ? <p>{category.description}</p> : null}
                </div>
              </div>
              <div className="entry-list card-grid portal-entry-grid">
                {category.entries.map((entry) => (
                  <PortalEntryItem entry={entry} key={entry.id} />
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

function PortalEntryItem({ entry }: { entry: PortalEntry }) {
  const description = entry.description.trim();
  const iconPath = entry.iconPath?.trim() || null;
  const [failedIconPath, setFailedIconPath] = useState<string | null>(null);
  const showConfiguredIcon = Boolean(
    iconPath && failedIconPath !== iconPath,
  );
  const descriptionId = description
    ? `portal-entry-description-${entry.id}`
    : undefined;
  const subtitle = portalEntrySubtitle(entry.url);
  const content = (
    <>
      <span
        aria-hidden="true"
        className={`portal-entry-art ${showConfiguredIcon ? "has-image" : "is-fallback"}`}
      >
        {showConfiguredIcon ? (
          <img
            alt=""
            onError={() => setFailedIconPath(iconPath)}
            src={iconPath ?? ""}
          />
        ) : (
          <span>{portalEntryMarker(entry.title)}</span>
        )}
      </span>
      <strong className="portal-entry-title">{entry.title}</strong>
      <span className="portal-entry-subtitle">{subtitle}</span>
      {entry.url ? (
        <ExternalLink
          aria-hidden="true"
          className="portal-entry-open-icon"
          size={15}
          strokeWidth={1.8}
        />
      ) : null}
      {description ? (
        <span
          className="portal-entry-tooltip"
          id={descriptionId}
          role="tooltip"
        >
          {description}
        </span>
      ) : null}
    </>
  );

  if (!entry.url) {
    return (
      <div
        aria-describedby={descriptionId}
        className="entry-item portal-entry-card muted"
        tabIndex={description ? 0 : undefined}
      >
        {content}
      </div>
    );
  }

  return (
    <a
      aria-describedby={descriptionId}
      className="entry-item portal-entry-card"
      href={entry.url}
      rel={entry.openInNewTab ? "noreferrer" : undefined}
      target={entry.openInNewTab ? "_blank" : undefined}
    >
      {content}
    </a>
  );
}

function portalEntrySubtitle(url: string | null): string {
  const normalizedUrl = url?.trim();
  if (!normalizedUrl) return "暂未配置链接";
  if (
    normalizedUrl.startsWith("/") ||
    normalizedUrl.startsWith("#") ||
    normalizedUrl.startsWith("?")
  ) {
    return "站内页面";
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    return parsedUrl.hostname.replace(/^www\./, "") || "链接入口";
  } catch {
    return "链接入口";
  }
}
