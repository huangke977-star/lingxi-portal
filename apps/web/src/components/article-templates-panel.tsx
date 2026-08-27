"use client";

import { Check, Eye, FileText, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArticleBody, displayArticleTaxonomy, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import {
  ArticleTemplate,
  ArticleTemplateInput,
  createArticleTemplate,
  deleteArticleTemplate,
  listArticleTemplates,
  updateArticleTemplate,
} from "@/lib/article-api";
import { isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { useRouter } from "next/navigation";

type DialogMode = "create" | "view" | "edit" | "delete";

interface TemplateForm {
  name: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string;
  titleColor: string;
  visibility: ArticleTemplate["visibility"];
  roleCodes: string;
}

const emptyForm: TemplateForm = {
  name: "",
  title: "",
  summary: "",
  content: "",
  category: "随笔",
  tags: "",
  titleColor: "",
  visibility: "public",
  roleCodes: "",
};

const visibilityOptions: Array<{ value: ArticleTemplate["visibility"]; label: string; labelEn: string }> = [
  { value: "public", label: "所有人可见", labelEn: "Public" },
  { value: "authenticated", label: "仅登录用户", labelEn: "Signed-in users" },
  { value: "role_restricted", label: "指定角色", labelEn: "Specific roles" },
  { value: "private", label: "仅自己", labelEn: "Only me" },
];

export function ArticleTemplatesPanel() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [templates, setTemplates] = useState<ArticleTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ArticleTemplate | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  const visibilityLabels = useMemo(
    () => visibilityOptions.map((option) => ({ value: option.value, label: locale === "en-US" ? option.labelEn : option.label })),
    [locale],
  );

  async function load(token: string) {
    const result = await listArticleTemplates(token);
    setTemplates(result.items);
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/articles/templates", locale))}`);
      return;
    }
    // Route and locale changes start a fresh template request cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    load(token)
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("无法读取文章模板。", "Could not load article templates."));
      })
      .finally(() => setIsLoading(false));
  }, [locale, phrase, router]);

  function templateToForm(template: ArticleTemplate): TemplateForm {
    return {
      name: template.name,
      title: template.title,
      summary: template.summary,
      content: template.content,
      category: template.category,
      tags: template.tags.join(", "),
      titleColor: template.titleColor,
      visibility: template.visibility,
      roleCodes: template.roleCodes.join(", "),
    };
  }

  function openCreate() {
    setSelectedTemplate(null);
    setForm(emptyForm);
    setDialogMode("create");
  }

  function openTemplate(template: ArticleTemplate, mode: Exclude<DialogMode, "create">) {
    setSelectedTemplate(template);
    setForm(templateToForm(template));
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedTemplate(null);
  }

  function updateForm<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function formInput(): ArticleTemplateInput {
    return {
      name: form.name.trim(),
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.content,
      category: form.category.trim(),
      tags: form.tags,
      titleColor: form.titleColor,
      visibility: form.visibility,
      roleCodes: form.roleCodes.split(",").map((value) => value.trim()).filter(Boolean),
    };
  }

  async function save() {
    const token = readAccessToken();
    if (!token) return;
    if (!form.name.trim() || !form.content.trim()) {
      setError(phrase("模板名称和正文不能为空。", "Template name and content are required."));
      return;
    }
    setIsSaving(true);
    try {
      const saved = dialogMode === "edit" && selectedTemplate
        ? await updateArticleTemplate(token, selectedTemplate.id, formInput())
        : await createArticleTemplate(token, formInput());
      setTemplates((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      closeDialog();
      setNotice(phrase(dialogMode === "edit" ? "文章模板已更新。" : "文章模板已创建。", dialogMode === "edit" ? "Article template updated." : "Article template created."));
    } catch (saveError) {
      if (isAuthExpiredError(saveError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(saveError instanceof Error ? saveError.message : phrase("模板保存失败。", "Could not save the template."));
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    const token = readAccessToken();
    if (!token || !selectedTemplate) return;
    setIsSaving(true);
    try {
      await deleteArticleTemplate(token, selectedTemplate.id);
      setTemplates((current) => current.filter((item) => item.id !== selectedTemplate.id));
      closeDialog();
      setNotice(phrase("文章模板已删除。", "Article template deleted."));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("模板删除失败。", "Could not delete the template."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="article-templates-panel">
      <header className="article-templates-heading">
        <div>
          <h1>{phrase("文章模板", "Article templates")}</h1>
          <p>{phrase("保存常用的标题、正文和文章设置，写文章时可以直接套用。", "Save reusable titles, content, and article settings for the writing page.")}</p>
        </div>
        <button aria-label={phrase("创建模板", "Create template")} className="article-icon-action" onClick={openCreate} title={phrase("创建模板", "Create template")} type="button"><Plus aria-hidden="true" size={17} /></button>
      </header>
      {isLoading ? <div className="article-empty-state">{phrase("正在读取文章模板。", "Loading article templates.")}</div> : templates.length ? (
        <div className="article-template-list">
          {templates.map((template) => (
            <article className="article-template-row" key={template.id}>
              <button className="article-template-row-main" onClick={() => openTemplate(template, "view")} type="button">
                <span className="article-template-row-icon"><FileText aria-hidden="true" size={17} /></span>
                <span className="article-template-row-copy"><strong>{template.name}</strong><small>{template.title || phrase("未设置文章标题", "No article title")}</small><small>{template.category ? displayArticleTaxonomy(template.category, locale) : phrase("未分类", "Uncategorized")} · {phrase(`更新于 ${formatArticleDate(template.updatedAt, locale)}`, `Updated ${formatArticleDate(template.updatedAt, locale)}`)}</small></span>
              </button>
              <div className="article-template-row-actions">
                <button aria-label={phrase(`查看模板 ${template.name}`, `View template ${template.name}`)} onClick={() => openTemplate(template, "view")} title={phrase("查看", "View")} type="button"><Eye aria-hidden="true" size={16} /></button>
                <button aria-label={phrase(`编辑模板 ${template.name}`, `Edit template ${template.name}`)} onClick={() => openTemplate(template, "edit")} title={phrase("编辑", "Edit")} type="button"><Pencil aria-hidden="true" size={16} /></button>
                <button aria-label={phrase(`删除模板 ${template.name}`, `Delete template ${template.name}`)} onClick={() => openTemplate(template, "delete")} title={phrase("删除", "Delete")} type="button"><Trash2 aria-hidden="true" size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="article-empty-state"><strong>{phrase("还没有文章模板", "No article templates yet")}</strong><span>{phrase("点击右上角的加号创建第一个模板。", "Use the plus button to create your first template.")}</span></div>}

      {dialogMode && typeof document !== "undefined" ? createPortal(
        <div className="modal-backdrop article-template-backdrop">
          <section aria-label={phrase("文章模板", "Article template")} aria-modal="true" className="article-template-dialog article-template-management-dialog" role="dialog">
            {dialogMode === "delete" ? (
              <>
                <header><span><Trash2 aria-hidden="true" size={17} /><strong>{phrase("删除文章模板", "Delete article template")}</strong></span></header>
                <p>{phrase(`确定删除模板“${selectedTemplate?.name ?? ""}”吗？删除后无法恢复。`, `Delete “${selectedTemplate?.name ?? ""}”? This cannot be undone.`)}</p>
                <footer><button aria-label={phrase("取消", "Cancel")} className="article-template-icon-button" onClick={closeDialog} title={phrase("取消", "Cancel")} type="button"><X aria-hidden="true" size={17} /></button><button aria-label={phrase("确定删除", "Confirm delete")} className="article-template-icon-button danger" disabled={isSaving} onClick={() => void remove()} title={phrase("确定删除", "Confirm delete")} type="button"><Trash2 aria-hidden="true" size={17} /></button></footer>
              </>
            ) : dialogMode === "view" ? (
              <>
                <header><span><FileText aria-hidden="true" size={17} /><strong>{selectedTemplate?.name}</strong></span></header>
                <div className="article-template-view-meta"><span>{selectedTemplate?.title || phrase("未设置文章标题", "No article title")}</span><small>{selectedTemplate?.category ? displayArticleTaxonomy(selectedTemplate.category, locale) : phrase("未分类", "Uncategorized")} · {selectedTemplate ? formatArticleDate(selectedTemplate.updatedAt, locale) : ""}</small></div>
                <div className="article-template-view-content"><ArticleBody content={selectedTemplate?.content || phrase("模板没有正文内容。", "This template has no content.")} /></div>
                <footer><button aria-label={phrase("关闭", "Close")} className="article-template-icon-button" onClick={closeDialog} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={17} /></button>{selectedTemplate ? <button aria-label={phrase("编辑模板", "Edit template")} className="article-template-icon-button primary" onClick={() => openTemplate(selectedTemplate, "edit")} title={phrase("编辑", "Edit")} type="button"><Pencil aria-hidden="true" size={17} /></button> : null}</footer>
              </>
            ) : (
              <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <header><span><FileText aria-hidden="true" size={17} /><strong>{phrase(dialogMode === "edit" ? "编辑文章模板" : "创建文章模板", dialogMode === "edit" ? "Edit article template" : "Create article template")}</strong></span></header>
                <div className="article-template-form-grid">
                  <label><span>{phrase("模板名称", "Template name")}</span><input autoFocus maxLength={80} onChange={(event) => updateForm("name", event.target.value)} required value={form.name} /></label>
                  <label><span>{phrase("文章标题", "Article title")}</span><input maxLength={120} onChange={(event) => updateForm("title", event.target.value)} value={form.title} /></label>
                  <label className="wide"><span>{phrase("摘要", "Summary")}</span><input maxLength={300} onChange={(event) => updateForm("summary", event.target.value)} value={form.summary} /></label>
                  <label><span>{phrase("分类", "Category")}</span><input maxLength={80} onChange={(event) => updateForm("category", event.target.value)} value={form.category} /></label>
                  <label><span>{phrase("标签", "Tags")}</span><input maxLength={500} onChange={(event) => updateForm("tags", event.target.value)} placeholder={phrase("用逗号分隔", "Comma separated")} value={form.tags} /></label>
                  <label><span>{phrase("阅读权限", "Visibility")}</span><GlassSelect ariaLabel={phrase("阅读权限", "Visibility")} onChange={(value) => updateForm("visibility", value)} options={visibilityLabels} value={form.visibility} /></label>
                  <label><span>{phrase("标题颜色", "Title color")}</span><input aria-label={phrase("标题颜色", "Title color")} className="article-template-color-input" onChange={(event) => updateForm("titleColor", event.target.value)} type="color" value={form.titleColor || "#2b2530"} /></label>
                  {form.visibility === "role_restricted" ? <label className="wide"><span>{phrase("可见角色", "Visible roles")}</span><input onChange={(event) => updateForm("roleCodes", event.target.value)} placeholder={phrase("用逗号分隔角色代码", "Comma separated role codes")} value={form.roleCodes} /></label> : null}
                  <label className="wide"><span>{phrase("模板正文", "Template content")}</span><textarea minLength={1} onChange={(event) => updateForm("content", event.target.value)} required value={form.content} /></label>
                </div>
                <footer><button aria-label={phrase("取消", "Cancel")} className="article-template-icon-button" onClick={closeDialog} title={phrase("取消", "Cancel")} type="button"><X aria-hidden="true" size={17} /></button><button aria-label={phrase("确定保存", "Confirm save")} className="article-template-icon-button primary" disabled={isSaving} title={phrase("确定保存", "Confirm save")} type="submit"><Check aria-hidden="true" size={17} /></button></footer>
              </form>
            )}
          </section>
        </div>,
        document.body,
      ) : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
