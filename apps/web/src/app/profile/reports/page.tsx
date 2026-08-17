"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, Flag, XCircle } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { listMyArticleReports, type ArticleReport } from "@/lib/article-api";

const REASON_LABEL: Record<string, string> = {
  spam: "垃圾广告",
  harassment: "辱骂骚扰",
  illegal: "违法违规",
  privacy: "隐私泄露",
  misinformation: "不实内容",
  other: "其他",
};

function statusLabel(status: ArticleReport["status"]) {
  if (status === "resolved") return "已处理";
  if (status === "rejected") return "已驳回";
  return "待处理";
}

function statusIcon(status: ArticleReport["status"]) {
  if (status === "resolved") return <CheckCircle2 aria-hidden="true" size={15} />;
  if (status === "rejected") return <XCircle aria-hidden="true" size={15} />;
  return <Clock3 aria-hidden="true" size={15} />;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export default function MyArticleReportsPage() {
  const [items, setItems] = useState<ArticleReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = "/login?from=%2Fprofile%2Freports";
      return;
    }
    Promise.all([getMe(token), listMyArticleReports(token)])
      .then(([, result]) => setItems(result.items))
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          window.location.href = "/login";
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取举报记录。");
      })
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <section className="p8-page p8-directory-page my-reports-page">
      <header className="p8-page-heading">
        <div>
          <span className="section-label"><Flag aria-hidden="true" size={14} /> REPORT HISTORY</span>
          <h1>我的举报</h1>
          <p>查看你提交的文章举报和处理结果。</p>
        </div>
      </header>
      {isLoading ? <div className="article-empty-state">正在读取举报记录。</div> : items.length ? (
        <div className="my-reports-list">
          {items.map((item) => (
            <article className="my-report-row" key={item.id}>
              <div className="my-report-main">
                <div className="my-report-title-line">
                  <strong>{item.article.title}</strong>
                  <span className={`my-report-status ${item.status}`}>{statusIcon(item.status)}{statusLabel(item.status)}</span>
                </div>
                <p>{REASON_LABEL[item.reason] ?? item.reason}{item.detail ? ` · ${item.detail}` : ""}</p>
                {item.resolution ? <small className="my-report-resolution">处理反馈：{item.resolution}</small> : null}
                <small>提交于 {formatDate(item.createdAt)}{item.handledAt ? ` · 处理于 ${formatDate(item.handledAt)}` : ""}</small>
              </div>
              <Link aria-label={`查看文章《${item.article.title}》`} className="my-report-article-link" href={`/articles/${item.article.slug}`} target="_blank" title="查看文章"><ExternalLink aria-hidden="true" size={16} /></Link>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state">暂无举报记录。</div>}
      <AppToast duration={3600} message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
