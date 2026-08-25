"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { AppToast } from "@/components/app-toast";
import { GroupReportMessagePreview } from "@/components/group-report-message-preview";
import { MyReportCommentPreview } from "@/components/my-report-comment-preview";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { type Article, getMyArticleReportPreview } from "@/lib/article-api";
import { listMyReports, type ModerationReport } from "@/lib/moderation-api";
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

function sourceLabel(source: ModerationReport["source"], phrase: (chinese: string, english: string) => string): string {
  if (source === "article") return phrase("文章举报", "Article report");
  if (source === "comment") return phrase("评论举报", "Comment report");
  return phrase("群消息举报", "Group message report");
}

function statusLabel(status: ModerationReport["status"], phrase: (chinese: string, english: string) => string): string {
  if (status === "resolved") return phrase("已处理", "Resolved");
  if (status === "rejected") return phrase("已驳回", "Rejected");
  return phrase("待处理", "Pending");
}

function statusIcon(status: ModerationReport["status"]) {
  if (status === "resolved") return <CheckCircle2 aria-hidden="true" size={15} />;
  if (status === "rejected") return <XCircle aria-hidden="true" size={15} />;
  return <Clock3 aria-hidden="true" size={15} />;
}

function formatDate(value: string, locale: "zh-CN" | "en-US") {
  return formatLocaleDate(value, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function reportTitle(item: ModerationReport, phrase: (chinese: string, english: string) => string): string {
  if (item.source === "article") return item.article?.title || phrase("文章内容", "Article content");
  if (item.source === "comment") return item.comment?.body || phrase("评论内容", "Comment content");
  return item.message?.body || item.message?.attachments[0]?.originalName || phrase("群消息内容", "Group message content");
}

function reportContext(item: ModerationReport, phrase: (chinese: string, english: string) => string): string {
  if (item.source === "comment") return item.article?.title || phrase("文章评论", "Article comment");
  if (item.source === "group_message") return item.group?.name || phrase("群聊消息", "Group message");
  return phrase("文章内容", "Article content");
}

function reportDetail(item: ModerationReport, phrase: (chinese: string, english: string) => string): string {
  return `${reportContext(item, phrase)} · ${reasonLabel(item.reason, phrase)}${item.detail ? ` · ${item.detail}` : ""}`;
}

export default function MyArticleReportsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [items, setItems] = useState<ModerationReport[]>([]);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [previewReport, setPreviewReport] = useState<ModerationReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/profile/reports", locale))}`);
      return;
    }
    Promise.all([getMe(token), listMyReports(token)])
      .then(([, result]) => setItems(result.items))
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/login", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("无法读取举报记录。", "Could not load report history."));
      })
      .finally(() => setIsLoading(false));
  }, [locale, phrase, router]);

  async function openReport(item: ModerationReport) {
    const token = readAccessToken();
    if (!token) return;
    setPreviewArticle(null);
    setPreviewReport(null);
    if (item.source !== "article") {
      setPreviewReport(item);
      return;
    }
    try {
      setPreviewArticle(await getMyArticleReportPreview(token, item.id));
    } catch (previewError) {
      if (isAuthExpiredError(previewError)) {
        clearAuthTokens();
        router.replace(localizedPath("/login", locale));
        return;
      }
      setError(previewError instanceof Error ? previewError.message : phrase("文章内容加载失败。", "Could not load article content."));
    }
  }

  return (
    <section className="p8-page p8-directory-page my-reports-page">
      <header className="p8-page-heading">
        <div>
          <h1>{phrase("我的举报", "My reports")}</h1>
          <p>{phrase("查看你提交的文章、评论和群消息举报及处理结果。", "Review your article, comment, and group message reports and their outcomes.")}</p>
        </div>
      </header>
      {isLoading ? <div className="article-empty-state">{phrase("正在读取举报记录。", "Loading report history.")}</div> : items.length ? (
        <div className="my-reports-list">
          {items.map((item) => (
            <article className="my-report-row" key={`${item.source}-${item.id}`}>
              <div className="my-report-main">
                <div className="my-report-title-line">
                  <button className="my-report-title-button" onClick={() => void openReport(item)} title={phrase("查看举报内容", "View reported content")} type="button">{reportTitle(item, phrase)}</button>
                  <span className={`my-report-source ${item.source}`}>{sourceLabel(item.source, phrase)}</span>
                  <small className="my-report-timestamps">{phrase(`提交于 ${formatDate(item.createdAt, locale)}`, `Submitted ${formatDate(item.createdAt, locale)}`)}{item.handledAt ? phrase(` · 处理于 ${formatDate(item.handledAt, locale)}`, ` · Processed ${formatDate(item.handledAt, locale)}`) : ""}</small>
                </div>
                <p aria-label={reportDetail(item, phrase)} title={reportDetail(item, phrase)}>{reportDetail(item, phrase)}</p>
                {item.resolution ? <small className="my-report-resolution">{phrase("处理反馈：", "Resolution: ")}{item.resolution}</small> : null}
              </div>
              <span className={`my-report-status ${item.status}`}>{statusIcon(item.status)}{statusLabel(item.status, phrase)}</span>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state">{phrase("暂无举报记录。", "No reports yet.")}</div>}
      {previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}
      {previewReport?.source === "comment" ? <MyReportCommentPreview onClose={() => setPreviewReport(null)} report={previewReport} /> : null}
      {previewReport?.source === "group_message" && previewReport.group && previewReport.message ? <GroupReportMessagePreview group={previewReport.group} message={previewReport.message} onClose={() => setPreviewReport(null)} /> : null}
      <AppToast duration={3600} message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
