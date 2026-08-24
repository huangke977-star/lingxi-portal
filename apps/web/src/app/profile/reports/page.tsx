"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Flag, XCircle } from "lucide-react";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getMyArticleReportPreview, listMyArticleReports, type Article, type ArticleReport } from "@/lib/article-api";
import { formatDate as formatLocaleDate, localizedPath } from "@/lib/i18n";

function reasonLabel(reason: string, phrase: (chinese: string, english: string) => string): string {
  const labels: Record<string, [string, string]> = {
    spam: ["垃圾广告", "Spam or advertising"],
    harassment: ["辱骂骚扰", "Harassment"],
    illegal: ["违法违规", "Illegal content"],
    privacy: ["隐私泄露", "Privacy violation"],
    misinformation: ["不实内容", "Misinformation"],
    other: ["其他", "Other"],
  };
  const label = labels[reason];
  return label ? phrase(...label) : reason;
}

function statusLabel(status: ArticleReport["status"], phrase: (chinese: string, english: string) => string) {
  if (status === "resolved") return phrase("已处理", "Resolved");
  if (status === "rejected") return phrase("已驳回", "Rejected");
  return phrase("待处理", "Pending");
}

function statusIcon(status: ArticleReport["status"]) {
  if (status === "resolved") return <CheckCircle2 aria-hidden="true" size={15} />;
  if (status === "rejected") return <XCircle aria-hidden="true" size={15} />;
  return <Clock3 aria-hidden="true" size={15} />;
}

function formatDate(value: string, locale: "zh-CN" | "en-US") {
  return formatLocaleDate(value, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function MyArticleReportsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [items, setItems] = useState<ArticleReport[]>([]);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/profile/reports", locale))}`);
      return;
    }
    Promise.all([getMe(token), listMyArticleReports(token)])
      .then(([, result]) => setItems(result.items))
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.push(localizedPath("/login", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("无法读取举报记录。", "Could not load report history."));
      })
      .finally(() => setIsLoading(false));
  }, [locale, phrase, router]);

  async function openArticlePreview(item: ArticleReport) {
    const token = readAccessToken();
    if (!token) return;
    try {
      setPreviewArticle(await getMyArticleReportPreview(token, item.id));
    } catch (previewError) {
      if (isAuthExpiredError(previewError)) {
        clearAuthTokens();
        router.push(localizedPath("/login", locale));
        return;
      }
      setError(previewError instanceof Error ? previewError.message : phrase("文章内容加载失败。", "Could not load article content."));
    }
  }

  return (
    <section className="p8-page p8-directory-page my-reports-page">
      <header className="p8-page-heading">
        <div>
          {locale === "zh-CN" ? <span className="section-label"><Flag aria-hidden="true" size={14} /> REPORT HISTORY</span> : null}
          <h1>{phrase("我的举报", "My reports")}</h1>
          <p>{phrase("查看你提交的文章举报和处理结果。", "Review article reports you submitted and their outcomes.")}</p>
        </div>
      </header>
      {isLoading ? <div className="article-empty-state">{phrase("正在读取举报记录。", "Loading report history.")}</div> : items.length ? (
        <div className="my-reports-list">
          {items.map((item) => (
            <article className="my-report-row" key={item.id}>
              <div className="my-report-main">
                <div className="my-report-title-line">
                  <button className="my-report-title-button" onClick={() => void openArticlePreview(item)} title={phrase("查看文章内容", "View article content")} type="button">{item.article.title}</button>
                  <small className="my-report-timestamps">{phrase(`提交于 ${formatDate(item.createdAt, locale)}`, `Submitted ${formatDate(item.createdAt, locale)}`)}{item.handledAt ? phrase(` · 处理于 ${formatDate(item.handledAt, locale)}`, ` · Processed ${formatDate(item.handledAt, locale)}`) : ""}</small>
                </div>
                <p>{reasonLabel(item.reason, phrase)}{item.detail ? ` · ${item.detail}` : ""}</p>
                {item.resolution ? <small className="my-report-resolution">{phrase("处理反馈：", "Resolution: ")}{item.resolution}</small> : null}
              </div>
              <span className={`my-report-status ${item.status}`}>{statusIcon(item.status)}{statusLabel(item.status, phrase)}</span>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state">{phrase("暂无举报记录。", "No reports yet.")}</div>}
      {previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}
      <AppToast duration={3600} message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
