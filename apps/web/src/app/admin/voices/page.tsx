"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnonymousTopicsPanel } from "@/components/anonymous-topics-panel";
import { AppToast } from "@/components/app-toast";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function AnonymousTopicManagementPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login?from=%2Fadmin%2Fvoices");
      return;
    }
    getMe(token)
      .then((user) => {
        if (!user.isSuperAdmin && user.role.level < 90) throw new Error("需要管理员权限。");
        setIsReady(true);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/login?from=%2Fadmin%2Fvoices");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "匿名话题管理加载失败。");
      });
  }, [router]);

  return (
    <section className="p8-page p8-directory-page anonymous-topic-management-page">
      <header className="p8-page-heading">
        <div><span className="section-label">MODERATION</span><h1>匿名话题管理</h1></div>
      </header>
      {isReady ? <AnonymousTopicsPanel management pageSize={20} showLoadMore showSearch showSort title="全部匿名话题" /> : !error ? <div className="article-empty-state">正在读取匿名话题。</div> : null}
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
