"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Flag, XCircle } from "lucide-react";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { AppToast } from "@/components/app-toast";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getMyArticleReportPreview, listMyArticleReports, type Article, type ArticleReport } from "@/lib/article-api";

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
  const router = useRouter();
  const [items, setItems] = useState<ArticleReport[]>([]);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.push("/login?from=%2Fprofile%2Freports");
      return;
    }
    Promise.all([getMe(token), listMyArticleReports(token)])
      .then(([, result]) => setItems(result.items))
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.push("/login");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取举报记录。");
      })
      .finally(() => setIsLoading(false));
  }, [router]);

  async function openArticlePreview(item: ArticleReport) {
    const token = readAccessToken();
    if (!token) return;
    try {
      setPreviewArticle(await getMyArticleReportPreview(token, item.id));
    } catch (previewError) {
      if (isAuthExpiredError(previewError)) {
        clearAuthTokens();
        router.push("/login");
        return;
      }
      setError(previewError instanceof Error ? previewError.message : "文章内容加载失败。");
    }
  }

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
                  <button className="my-report-title-button" onClick={() => void openArticlePreview(item)} title="查看文章内容" type="button">{item.article.title}</button>
                  <small className="my-report-timestamps">提交于 {formatDate(item.createdAt)}{item.handledAt ? ` · 处理于 ${formatDate(item.handledAt)}` : ""}</small>
                </div>
                <p>{REASON_LABEL[item.reason] ?? item.reason}{item.detail ? ` · ${item.detail}` : ""}</p>
                {item.resolution ? <small className="my-report-resolution">处理反馈：{item.resolution}</small> : null}
              </div>
              <span className={`my-report-status ${item.status}`}>{statusIcon(item.status)}{statusLabel(item.status)}</span>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state">暂无举报记录。</div>}
      {previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}
      <AppToast duration={3600} message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
