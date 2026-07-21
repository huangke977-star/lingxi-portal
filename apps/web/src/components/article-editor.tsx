"use client";

import Link from "next/link";
import { ImagePlus, Save, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleBody } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  ArticleInput,
  ARTICLE_STATUS_LABEL,
  ARTICLE_VISIBILITY_LABEL,
  createArticle,
  deleteArticle,
  getMyArticle,
  publishArticle,
  unpublishArticle,
  updateArticle,
  uploadArticleImages,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_ARTICLE_IMAGES = 20;
const PENDING_IMAGE_PATH_PREFIX = "/__pending_article_image__/";

interface PendingArticleImage {
  id: string;
  file: File;
  marker: string;
  previewUrl: string;
}

const emptyDraft: ArticleInput = {
  title: "",
  summary: "",
  content: "",
  category: "",
  tags: "",
  titleColor: "",
  visibility: "public",
  roleCodes: [],
};

export function ArticleEditor({ articleId }: { articleId?: number }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [draft, setDraft] = useState<ArticleInput>(emptyDraft);
  const [pendingImages, setPendingImages] = useState<PendingArticleImage[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(articleId));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingImagesRef = useRef<PendingArticleImage[]>([]);
  const pendingImageUrls = useMemo(
    () => Object.fromEntries(pendingImages.map((image) => [image.marker, image.previewUrl])),
    [pendingImages],
  );

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    pendingImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  function applyArticle(loaded: Article) {
    if (loaded.status === "deleted") {
      router.replace("/articles/mine?status=deleted");
      return;
    }
    setArticle(loaded);
    setDraft({
      title: loaded.title,
      summary: loaded.summary,
      content: loaded.content,
      category: loaded.category,
      tags: loaded.tags.join(", "),
      titleColor: loaded.titleColor,
      visibility: loaded.visibility,
      roleCodes: loaded.allowedRoles.map((role) => role.code),
    });
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`/login?from=${encodeURIComponent(articleId ? `/articles/edit/${articleId}` : "/articles/write")}`);
      return;
    }
    const requests: [Promise<AuthUser>, Promise<Article> | null] = [
      getMe(token),
      articleId ? getMyArticle(token, articleId) : null,
    ];
    Promise.all(requests.filter(Boolean) as Array<Promise<AuthUser | Article>>)
      .then((results) => {
        setUser(results[0] as AuthUser);
        if (articleId && results[1]) applyArticle(results[1] as Article);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取文章。");
      })
      .finally(() => setIsLoading(false));
    // The editor identity is fixed for the route lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, router]);

  function prepareImages(files: File[]): PendingArticleImage[] {
    const availableSlots = Math.max(
      0,
      MAX_ARTICLE_IMAGES - (article?.images.length ?? 0) - pendingImages.length,
    );
    if (!availableSlots) {
      setError(`单篇文章最多包含 ${MAX_ARTICLE_IMAGES} 张图片。`);
      return [];
    }

    const accepted: PendingArticleImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} 不是支持的图片格式。`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setError(`${file.name} 超过单张 10MB 限制。`);
        continue;
      }
      if (accepted.length >= availableSlots) break;
      const id = crypto.randomUUID();
      accepted.push({
        id,
        file,
        marker: `${PENDING_IMAGE_PATH_PREFIX}${id}`,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (files.length > accepted.length && accepted.length === availableSlots) {
      setError(`本次最多还能添加 ${availableSlots} 张图片。`);
    }
    return accepted;
  }

  function insertImagesAtCursor(files: File[]) {
    const accepted = prepareImages(files);
    if (!accepted.length) return;

    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.content.length;
    const end = textarea?.selectionEnd ?? start;
    const before = draft.content.slice(0, start);
    const after = draft.content.slice(end);
    const markdown = accepted
      .map((image) => `![${sanitizeImageAlt(image.file.name)}](${image.marker})`)
      .join("\n\n");
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
    const inserted = `${prefix}${markdown}${suffix}`;
    const nextContent = `${before}${inserted}${after}`;
    const nextCursor = before.length + prefix.length + markdown.length;

    setDraft((current) => ({ ...current, content: nextContent }));
    setPendingImages((current) => [...current, ...accepted]);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function removePendingImage(image: PendingArticleImage) {
    URL.revokeObjectURL(image.previewUrl);
    setPendingImages((current) => current.filter((item) => item.id !== image.id));
    setDraft((current) => ({
      ...current,
      content: removePendingImageMarkdown(current.content, image.marker),
    }));
  }

  function releasePendingImages() {
    pendingImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    pendingImagesRef.current = [];
    setPendingImages([]);
  }

  function currentEditableStatus(): Article["status"] {
    if (!article) return "draft";
    if (article.status === "published" || article.status === "unpublished" || article.status === "blocked") return article.status;
    return "draft";
  }

  async function saveArticle(shouldPublish: boolean) {
    const token = readAccessToken();
    if (!token) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      setError("标题和正文不能为空。");
      return;
    }
    setIsSaving(true);
    try {
      const wasNewArticle = !article;
      const usedPendingImages = pendingImages.filter((image) => draft.content.includes(image.marker));
      let saved = article;
      let finalContent = draft.content;

      if (!saved) {
        saved = await createArticle(token, {
          ...draft,
          content: stripPendingImageMarkdown(draft.content, usedPendingImages),
          status: "draft",
        });
      }

      if (usedPendingImages.length) {
        const imagePaths = await uploadArticleImages(
          token,
          saved.id,
          usedPendingImages.map((image) => image.file),
        );
        if (imagePaths.length !== usedPendingImages.length) {
          throw new Error("部分图片上传失败，请重新保存。");
        }
        finalContent = replacePendingImageMarkers(draft.content, usedPendingImages, imagePaths);
      }

      if (!wasNewArticle || usedPendingImages.length) {
        saved = await updateArticle(token, saved.id, {
          ...draft,
          content: finalContent,
          status: wasNewArticle ? saved.status : currentEditableStatus(),
        });
      }

      if (shouldPublish) {
        await publishArticle(token, saved.id);
        releasePendingImages();
        router.replace("/articles/mine?status=published");
        return;
      }

      releasePendingImages();
      applyArticle(saved);
      if (wasNewArticle && !articleId) {
        window.history.replaceState(window.history.state, "", `/articles/edit/${saved.id}`);
      }
      setNotice(saved.status === "blocked" ? "修改已保存，文章仍处于受限状态。" : wasNewArticle ? "草稿已保存。" : "文章修改已保存。");
    } catch (saveError) {
      if (isAuthExpiredError(saveError)) {
        clearAuthTokens();
        router.replace("/");
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "文章保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function takeOffline() {
    if (!article) return;
    const token = readAccessToken();
    if (!token) return;
    try {
      const updated = await unpublishArticle(token, article.id);
      applyArticle(updated);
      setNotice("文章已下架。");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "文章下架失败。");
    }
  }

  async function moveToTrash() {
    if (!article || !window.confirm(`将《${article.title}》移入回收站吗？`)) return;
    const token = readAccessToken();
    if (!token) return;
    try {
      await deleteArticle(token, article.id);
      router.replace("/articles/mine?status=deleted");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "文章删除失败。");
    }
  }

  return (
    <section className="page-shell articles-page article-editor-page">
      <header className="page-header articles-header">
        <span className="eyebrow">HLOVET Journal</span>
        <div className="title-row"><div><h1>{article ? "编辑文章" : "写文章"}</h1><p>{article ? `当前状态：${ARTICLE_STATUS_LABEL[article.status]}` : "从一个标题开始，内容会自动保存在你的创作空间中。"}</p></div></div>
      </header>
      <ArticleCenterNav active="mine" isLoggedIn user={user} showWrite={false} />
      <Link className="article-back-link" href="/articles/mine">返回创作列表</Link>

      {isLoading ? <div className="article-empty-state">正在读取文章。</div> : (
        <div className="article-editor-workspace">
          <section className="article-editor-panel">
            {article?.status === "blocked" ? <div className="article-blocked-reason">这篇文章当前受限。{article.blockedReason ? `原因：${article.blockedReason}` : "修改可以保存，但需要管理员解除限制后才能重新发布。"}</div> : null}
            <div className="article-editor-fields">
              <input className="article-title-input" maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="文章标题" value={draft.title} />
              <input maxLength={300} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="摘要，可选" value={draft.summary} />
              <div className="article-editor-grid"><input maxLength={80} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="分类，例如：服务器经验" value={draft.category} /><input maxLength={500} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="标签，用逗号分隔" value={draft.tags} /></div>
              <div className="article-editor-grid"><label>阅读权限<select onChange={(event) => setDraft({ ...draft, visibility: event.target.value as ArticleInput["visibility"] })} value={draft.visibility}>{Object.entries(ARTICLE_VISIBILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>标题颜色<input aria-label="标题颜色" onChange={(event) => setDraft({ ...draft, titleColor: event.target.value })} type="color" value={draft.titleColor || "#2b2530"} /></label></div>
              {draft.visibility === "role_restricted" ? <input onChange={(event) => setDraft({ ...draft, roleCodes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="角色代码，用逗号分隔" value={draft.roleCodes.join(", ")} /> : null}
            </div>
            <textarea className="article-editor-textarea" onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="支持 Markdown：标题、列表、表格、引用、链接、图片和代码块" ref={textareaRef} value={draft.content} />
            <div className="article-editor-upload"><label className="text-action"><ImagePlus aria-hidden="true" size={16} />添加图片<input accept="image/jpeg,image/png,image/webp,image/avif" hidden multiple onChange={(event) => { insertImagesAtCursor(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" /></label><span>{pendingImages.length ? `待上传 ${pendingImages.length} 张，保存时才会上传` : "支持 JPG、PNG、WebP、AVIF，图片插入当前光标位置"}</span></div>
            {pendingImages.length ? <div className="article-pending-images">{pendingImages.map((image) => <span key={image.id}>{image.file.name}<button aria-label={`移除 ${image.file.name}`} onClick={() => removePendingImage(image)} title="移除图片" type="button"><X aria-hidden="true" size={14} /></button></span>)}</div> : null}
            <div className="article-editor-actions"><button className="button secondary" disabled={isSaving} onClick={() => void saveArticle(false)} type="button"><Save aria-hidden="true" size={16} />{isSaving ? "保存中" : article ? "保存修改" : "保存草稿"}</button><button className="button" disabled={isSaving || article?.status === "blocked"} onClick={() => void saveArticle(true)} type="button"><Send aria-hidden="true" size={16} />发布文章</button>{article?.status === "published" ? <button className="text-action" disabled={isSaving} onClick={() => void takeOffline()} type="button">下架</button> : null}{article ? <button className="text-danger-action" disabled={isSaving} onClick={() => void moveToTrash()} type="button"><Trash2 aria-hidden="true" size={16} />删除</button> : null}</div>
          </section>
          <aside className="article-editor-preview"><div className="article-editor-preview-heading"><span className="section-label">Preview</span><span>正文预览</span></div><ArticleBody content={draft.content || "开始输入后，这里会显示文章预览。"} pendingImageUrls={pendingImageUrls} /></aside>
        </div>
      )}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function sanitizeImageAlt(value: string): string {
  return value.replace(/[\[\]\r\n]/g, " ").trim() || "图片";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePendingImageMarkdown(content: string, marker: string): string {
  const imagePattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(marker)}\\)\\n*`, "g");
  return content.replace(imagePattern, "").replace(/\n{3,}/g, "\n\n");
}

function stripPendingImageMarkdown(
  content: string,
  pendingImages: PendingArticleImage[],
): string {
  return pendingImages.reduce(
    (current, image) => removePendingImageMarkdown(current, image.marker),
    content,
  );
}

function replacePendingImageMarkers(
  content: string,
  pendingImages: PendingArticleImage[],
  imagePaths: string[],
): string {
  return pendingImages.reduce(
    (current, image, index) => current.replaceAll(image.marker, imagePaths[index]),
    content,
  );
}
