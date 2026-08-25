"use client";

import { MessageSquare, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/language-provider";
import { resolveApiUrl } from "@/lib/auth-api";
import { formatDate } from "@/lib/i18n";
import type { ModerationReport } from "@/lib/moderation-api";

export function MyReportCommentPreview({ report, onClose }: { report: ModerationReport; onClose: () => void }) {
  const { locale, phrase, t } = useLanguage();
  if (typeof document === "undefined" || !report.comment) return null;
  const author = report.targetUser;

  return createPortal(
    <div className="group-management-preview-backdrop" onClick={onClose} role="presentation">
      <section aria-modal="true" className="group-management-preview my-report-comment-preview" onClick={(event) => event.stopPropagation()} role="dialog">
        <header>
          <span><MessageSquare aria-hidden="true" size={17} /><strong>{report.article?.title || phrase("评论内容", "Comment content")}</strong></span>
          <button aria-label={phrase("关闭评论预览", "Close comment preview")} onClick={onClose} title={t("common.close")} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="my-report-comment-preview-content">
          <div className="my-report-comment-author">
            <span className="chat-user-avatar">{author?.avatarUrl ? <img alt="" src={resolveApiUrl(author.avatarUrl)} /> : author?.nickname?.slice(0, 1) || "?"}</span>
            <div><strong>{author?.nickname || phrase("评论作者", "Comment author")}</strong><small>{formatDate(report.createdAt, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</small></div>
          </div>
          <p>{report.comment.body || phrase("评论内容为空。", "This comment has no text.")}</p>
        </div>
      </section>
    </div>,
    document.body,
  );
}
