"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { ArticleBody } from "@/components/article-ui";
import type { Article } from "@/lib/article-api";

export function AdminArticlePreviewModal({ article, onClose }: { article: Article; onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-backdrop article-preview-backdrop admin-article-preview-backdrop" role="presentation">
      <section aria-label="文章内容预览" aria-modal="true" className="admin-article-preview-modal" role="dialog">
        <header>
          <span>文章内容</span>
          <button aria-label="关闭文章预览" onClick={onClose} title="关闭" type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <ArticleBody content={article.content} />
      </section>
    </div>,
    document.body,
  );
}
