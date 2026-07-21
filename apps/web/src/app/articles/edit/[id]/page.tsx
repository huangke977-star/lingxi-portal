"use client";

import { useParams } from "next/navigation";
import { ArticleEditor } from "@/components/article-editor";

export default function EditArticlePage() {
  const params = useParams<{ id: string }>();
  const articleId = Number(params.id);
  return Number.isInteger(articleId) && articleId > 0
    ? <ArticleEditor articleId={articleId} />
    : null;
}
