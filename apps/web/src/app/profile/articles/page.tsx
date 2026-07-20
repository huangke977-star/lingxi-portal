"use client";

import { FileText, ImagePlus, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ArticleBody, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import {
  Article,
  ArticleInput,
  ARTICLE_STATUS_LABEL,
  ARTICLE_VISIBILITY_LABEL,
  createArticle,
  deleteArticle,
  listMyArticles,
  publishArticle,
  unpublishArticle,
  updateArticle,
  uploadArticleImages,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_ARTICLE_IMAGES = 20;

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

export default function MyArticlesPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [draft, setDraft] = useState<ArticleInput>(emptyDraft);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadArticles(token: string) {
    const result = await listMyArticles(token, { pageSize: 50, sort: "latest" });
    setArticles(result.items);
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = "/login?from=%2Fprofile%2Farticles";
      return;
    }
    Promise.all([getMe(token), listMyArticles(token, { pageSize: 50, sort: "latest" })])
      .then(([currentUser, result]) => {
        setUser(currentUser);
        setArticles(result.items);
        if (new URLSearchParams(window.location.search).get("new") === "1") openNewArticle();
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          window.location.href = "/";
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取文章。");
      })
      .finally(() => setIsLoading(false));
    // This page owns its initial authenticated load.
  }, []);

  function openNewArticle() {
    setSelectedArticle(null);
    setDraft({ ...emptyDraft, roleCodes: [] });
    setPendingImages([]);
  }

  function openArticle(article: Article) {
    setSelectedArticle(article);
    setDraft({
      title: article.title,
      summary: article.summary,
      content: article.content,
      category: article.category,
      tags: article.tags.join(", "),
      titleColor: article.titleColor,
      visibility: article.visibility,
      roleCodes: article.allowedRoles.map((role) => role.code),
    });
    setPendingImages([]);
  }

  function validateImages(files: File[]): File[] {
    const accepted: File[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(`${file.name} 不是支持的图片格式。`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setError(`${file.name} 超过单张 10MB 限制。`);
        continue;
      }
      accepted.push(file);
    }
    return accepted.slice(0, MAX_ARTICLE_IMAGES);
  }

  async function saveArticle(publish: boolean) {
    const token = readAccessToken();
    if (!token) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      setError("标题和正文不能为空。");
      return;
    }
    setIsSaving(true);
    try {
      let article = selectedArticle
        ? await updateArticle(token, selectedArticle.id, { ...draft, status: "draft" })
        : await createArticle(token, { ...draft, status: "draft" });
      if (pendingImages.length) {
        const imagePaths = await uploadArticleImages(token, article.id, pendingImages);
        const imageMarkdown = imagePaths.map((path, index) => `![图片 ${index + 1}](${path})`).join("\n\n");
        article = await updateArticle(token, article.id, { ...draft, content: `${draft.content.trim()}\n\n${imageMarkdown}`, status: "draft" });
      }
      if (publish) article = await publishArticle(token, article.id);
      await loadArticles(token);
      setSelectedArticle(article);
      setDraft({
        title: article.title,
        summary: article.summary,
        content: article.content,
        category: article.category,
        tags: article.tags.join(", "),
        titleColor: article.titleColor,
        visibility: article.visibility,
        roleCodes: article.allowedRoles.map((role) => role.code),
      });
      setPendingImages([]);
      setNotice(publish ? "文章已发布。" : "草稿已保存。");
    } catch (saveError) {
      if (isAuthExpiredError(saveError)) {
        clearAuthTokens();
        window.location.href = "/";
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "文章保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeArticle(article: Article) {
    if (!window.confirm(`确定删除《${article.title}》吗？`)) return;
    const token = readAccessToken();
    if (!token) return;
    try {
      await deleteArticle(token, article.id);
      if (selectedArticle?.id === article.id) openNewArticle();
      await loadArticles(token);
      setNotice("文章已移入回收站。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "文章删除失败。");
    }
  }

  async function takeArticleOffline(article: Article) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await unpublishArticle(token, article.id);
      await loadArticles(token);
      if (selectedArticle?.id === article.id) setSelectedArticle({ ...article, status: "unpublished" });
      setNotice("文章已下架，内容仍保留在你的文章列表中。");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "文章下架失败。");
    }
  }

  return (
    <section className="page-shell my-articles-page">
      <header className="page-header">
        <span className="eyebrow">My Writing</span>
        <div className="title-row"><div><h1>我的文章</h1><p>{user ? `${user.nickname} 的创作空间` : "管理你的草稿和已发布内容"}</p></div><button className="text-action" onClick={openNewArticle} type="button"><Plus aria-hidden="true" size={16} />新建文章</button></div>
      </header>
      {isLoading ? <div className="article-empty-state">正在读取你的文章。</div> : <div className="my-articles-layout">
        <aside className="my-articles-list">
          <div className="my-articles-list-heading"><span>{articles.length} 篇</span><FileText aria-hidden="true" size={17} /></div>
          {articles.map((article) => <button className={`my-article-row${selectedArticle?.id === article.id ? " active" : ""}`} key={article.id} onClick={() => openArticle(article)} type="button"><span className="my-article-row-title">{article.title || "未命名文章"}</span><span><span className={`article-status-dot ${article.status}`}>{ARTICLE_STATUS_LABEL[article.status]}</span><time>{formatArticleDate(article.publishedAt || article.updatedAt)}</time></span></button>)}
          {!articles.length ? <div className="article-empty-inline">还没有文章，开始写下第一篇。</div> : null}
        </aside>
        <section className="article-editor-panel">
          <div className="article-editor-toolbar"><span className="section-label">{selectedArticle ? "Edit article" : "New article"}</span><span>{selectedArticle ? ARTICLE_STATUS_LABEL[selectedArticle.status] : "草稿"}</span></div>
          <div className="article-editor-fields">
            <input className="article-title-input" maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="文章标题" value={draft.title} />
            <input maxLength={300} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="摘要，可选" value={draft.summary} />
            <div className="article-editor-grid"><input maxLength={80} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="分类，例如：服务器经验" value={draft.category} /><input maxLength={500} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="标签，用逗号分隔" value={draft.tags} /></div>
            <div className="article-editor-grid"><label>阅读权限<select onChange={(event) => setDraft({ ...draft, visibility: event.target.value as ArticleInput["visibility"] })} value={draft.visibility}>{Object.entries(ARTICLE_VISIBILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>标题颜色<input aria-label="标题颜色" onChange={(event) => setDraft({ ...draft, titleColor: event.target.value })} type="color" value={draft.titleColor || "#2b2530"} /></label></div>
            {draft.visibility === "role_restricted" ? <input onChange={(event) => setDraft({ ...draft, roleCodes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="角色代码，用逗号分隔，例如 qi_refining,administrator" value={draft.roleCodes.join(", ")} /> : null}
          </div>
          <textarea className="article-editor-textarea" onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="写下你的内容，支持简单 Markdown：# 标题、**加粗**、- 列表、```代码```" value={draft.content} />
          <div className="article-editor-upload"><label className="text-action"><ImagePlus aria-hidden="true" size={16} />添加图片<input accept="image/jpeg,image/png,image/webp,image/avif" hidden multiple onChange={(event) => setPendingImages(validateImages(Array.from(event.target.files ?? [])))} type="file" /></label><span>{pendingImages.length ? `待上传 ${pendingImages.length} 张，单张不超过 10MB` : "支持 JPG、PNG、WebP、AVIF"}</span></div>
          <div className="article-editor-preview"><div className="article-editor-preview-heading"><span className="section-label">Preview</span><span>正文预览</span></div><ArticleBody content={draft.content || "开始输入后，这里会显示文章预览。"} /></div>
          <div className="article-editor-actions"><button className="button secondary" disabled={isSaving} onClick={() => void saveArticle(false)} type="button"><Save aria-hidden="true" size={16} />{isSaving ? "保存中" : "保存草稿"}</button><button className="button" disabled={isSaving} onClick={() => void saveArticle(true)} type="button"><Send aria-hidden="true" size={16} />发布文章</button>{selectedArticle?.status === "published" ? <button className="text-action" disabled={isSaving} onClick={() => void takeArticleOffline(selectedArticle)} type="button">下架</button> : null}{selectedArticle ? <button className="text-danger-action" disabled={isSaving} onClick={() => void removeArticle(selectedArticle)} type="button"><Trash2 aria-hidden="true" size={16} />删除</button> : null}</div>
        </section>
      </div>}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
