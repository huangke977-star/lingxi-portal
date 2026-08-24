"use client";

import { useEffect, useRef } from "react";
import { useLanguage } from "@/components/language-provider";

export function ArticleInfiniteFooter({
  hasMore,
  isLoading,
  onLoadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useLanguage();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || isLoading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  return (
    <div className="article-infinite-footer" ref={sentinelRef}>
      {isLoading ? <span>{t("common.loadingMore")}</span> : hasMore ? null : <span>{t("common.endOfList")}</span>}
    </div>
  );
}
