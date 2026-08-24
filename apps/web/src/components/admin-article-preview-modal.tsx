"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { ArticleBody } from "@/components/article-ui";
import { useLanguage } from "@/components/language-provider";
import type { Article } from "@/lib/article-api";

export function AdminArticlePreviewModal({ article, onClose }: { article: Article; onClose: () => void }) {
  const { phrase, t } = useLanguage();
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-backdrop article-preview-backdrop admin-article-preview-backdrop" role="presentation">
      <section aria-label={phrase("文章内容预览", "Article content preview")} aria-modal="true" className="admin-article-preview-modal" role="dialog">
        <header>
          <span>{phrase("文章内容", "Article content")}</span>
          <button aria-label={phrase("关闭文章预览", "Close article preview")} onClick={onClose} title={t("common.close")} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="admin-article-preview-content">
          <ArticleBody content={article.content} />
        </div>
      </section>
    </div>,
    document.body,
  );
}
