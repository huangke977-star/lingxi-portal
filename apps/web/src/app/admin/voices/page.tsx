"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnonymousTopicsPanel } from "@/components/anonymous-topics-panel";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader } from "@/components/admin-page-header";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";

export default function AnonymousTopicManagementPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [error, setError] = useState("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/voices", locale))}`);
      return;
    }
    getMe(token)
      .then((user) => {
        if (!isSiteManager(user)) throw new Error(phrase("需要管理员权限。", "Administrator access is required."));
        setIsReady(true);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/voices", locale))}`);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("匿名话题管理加载失败。", "Could not load anonymous topic management."));
      });
  }, [locale, phrase, router]);

  return (
    <section className="p8-page p8-directory-page anonymous-topic-management-page">
      <AdminPageHeader className="p8-page-heading" description={phrase("查看、搜索和管理匿名话题。", "Review, search, and manage anonymous topics.")} title={phrase("匿名话题管理", "Anonymous topic management")} />
      {isReady ? <AnonymousTopicsPanel management pageSize={20} showLoadMore showSearch showSort title={phrase("全部匿名话题", "All anonymous topics")} /> : !error ? <div className="article-empty-state">{phrase("正在读取匿名话题。", "Loading anonymous topics.")}</div> : null}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
