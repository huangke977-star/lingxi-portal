"use client";

import { Check, ChevronDown, Eye, FileText, Pencil, Plus, Shapes, Tags, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";
import { useRouter } from "next/navigation";

type DialogMode = "create" | "view" | "edit" | "delete";

const MAX_SELECTED_TEMPLATE_TAGS = 6;
const ARTICLE_CATEGORY_OPTIONS = ["随笔", "技术", "服务器", "工具", "资源", "教程", "生活", "公告"];
const ARTICLE_TAG_OPTIONS = ["AI", "开发", "前端", "后端", "数据库", "运维", "服务器", "网络", "工具", "资源", "教程", "经验", "随笔", "生活", "公告"];

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
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);

  const visibilityLabels = useMemo(
    () => visibilityOptions.map((option) => ({ value: option.value, label: locale === "en-US" ? option.labelEn : option.label })),
    [locale],
  );
  const selectedTags = useMemo(() => parseArticleTags(form.tags), [form.tags]);
  const configuredCategoryOptions = useMemo(
    () => siteSettings?.taxonomies?.categories?.filter((item) => item.enabled).map((item) => item.name) ?? ARTICLE_CATEGORY_OPTIONS,
    [siteSettings],
  );
  const configuredTagOptions = useMemo(
    () => siteSettings?.taxonomies?.tags?.filter((item) => item.enabled).map((item) => item.name) ?? ARTICLE_TAG_OPTIONS,
    [siteSettings],
  );
  const categoryOptions = useMemo(
    () => form.category && !configuredCategoryOptions.includes(form.category)
      ? [form.category, ...configuredCategoryOptions]
      : configuredCategoryOptions,
    [configuredCategoryOptions, form.category],
  );
  const tagOptions = useMemo(
    () => Array.from(new Set([...configuredTagOptions, ...selectedTags])),
    [configuredTagOptions, selectedTags],
  );

  async function load(token: string) {
    const [result, settings] = await Promise.all([
      listArticleTemplates(token),
      getPublicSiteSettings().catch(() => null),
    ] as const);
    setTemplates(result.items);
    if (settings) setSiteSettings(settings);
  }

  useEffect(() => {
    if (!isTagPickerOpen) return;
    function closeTagPicker(event: PointerEvent) {
      if (!tagPickerRef.current?.contains(event.target as Node)) setIsTagPickerOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsTagPickerOpen(false);
    }
    document.addEventListener("pointerdown", closeTagPicker);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeTagPicker);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isTagPickerOpen]);

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
    setForm({ ...emptyForm, category: configuredCategoryOptions[0] ?? emptyForm.category });
    setIsTagPickerOpen(false);
    setDialogMode("create");
  }

  function openTemplate(template: ArticleTemplate, mode: Exclude<DialogMode, "create">) {
    setSelectedTemplate(template);
    setForm(templateToForm(template));
    setIsTagPickerOpen(false);
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedTemplate(null);
    setIsTagPickerOpen(false);
  }

  function updateForm<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleTag(tag: string) {
    const nextTags = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
    if (nextTags.length > MAX_SELECTED_TEMPLATE_TAGS) {
      setError(phrase(`最多选择 ${MAX_SELECTED_TEMPLATE_TAGS} 个标签。`, `Choose at most ${MAX_SELECTED_TEMPLATE_TAGS} tags.`));
      return;
    }
    updateForm("tags", nextTags.join(","));
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
          <section aria-label={phrase("文章模板", "Article template")} aria-modal="true" className="announcement-editor article-template-management-dialog" role="dialog">
            {dialogMode === "delete" ? (
              <>
                <header><span><Trash2 aria-hidden="true" size={17} /><strong>{phrase("删除文章模板", "Delete article template")}</strong></span></header>
                <div className="announcement-editor-body article-template-delete-body"><p className="wide">{phrase(`确定删除模板“${selectedTemplate?.name ?? ""}”吗？删除后无法恢复。`, `Delete “${selectedTemplate?.name ?? ""}”? This cannot be undone.`)}</p></div>
                <footer><button aria-label={phrase("取消", "Cancel")} className="article-template-icon-button" onClick={closeDialog} title={phrase("取消", "Cancel")} type="button"><X aria-hidden="true" size={17} /></button><button aria-label={phrase("确定删除", "Confirm delete")} className="article-template-icon-button danger" disabled={isSaving} onClick={() => void remove()} title={phrase("确定删除", "Confirm delete")} type="button"><Trash2 aria-hidden="true" size={17} /></button></footer>
              </>
            ) : dialogMode === "view" ? (
              <>
                <header><span><FileText aria-hidden="true" size={17} /><strong>{selectedTemplate?.name}</strong></span><button aria-label={phrase("关闭", "Close")} onClick={closeDialog} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={17} /></button></header>
                <div className="article-template-preview-body">
                  <article className="article-template-reading-layout">
                    <header><h1 style={selectedTemplate?.titleColor ? { color: selectedTemplate.titleColor } : undefined}>{selectedTemplate?.title || phrase("未设置文章标题", "No article title")}</h1><div><span>{selectedTemplate?.category ? displayArticleTaxonomy(selectedTemplate.category, locale) : phrase("未分类", "Uncategorized")}</span><span>{selectedTemplate ? formatArticleDate(selectedTemplate.updatedAt, locale) : ""}</span></div></header>
                    <main><ArticleBody content={selectedTemplate?.content || phrase("模板没有正文内容。", "This template has no content.")} /></main>
                  </article>
                </div>
                <footer>{selectedTemplate ? <button aria-label={phrase("编辑模板", "Edit template")} className="article-template-icon-button primary" onClick={() => openTemplate(selectedTemplate, "edit")} title={phrase("编辑", "Edit")} type="button"><Pencil aria-hidden="true" size={17} /></button> : null}</footer>
              </>
            ) : (
              <form className="article-template-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <header><span><FileText aria-hidden="true" size={17} /><strong>{phrase(dialogMode === "edit" ? "编辑文章模板" : "创建文章模板", dialogMode === "edit" ? "Edit article template" : "Create article template")}</strong></span></header>
                <div className="announcement-editor-body article-template-form-body">
                  <label className="article-template-name-field"><input aria-label={phrase("模板名称", "Template name")} autoFocus maxLength={80} onChange={(event) => updateForm("name", event.target.value)} placeholder={phrase("模板名称", "Template name")} required value={form.name} /></label>
                  <div className="article-title-field"><input aria-label={phrase("文章标题", "Article title")} className="article-title-input" maxLength={120} onChange={(event) => updateForm("title", event.target.value)} placeholder={phrase("文章标题", "Article title")} value={form.title} /><input aria-label={phrase("标题颜色", "Title color")} className="article-title-color-input" onChange={(event) => updateForm("titleColor", event.target.value)} type="color" value={form.titleColor || "#2b2530"} /></div>
                  <div className="article-template-taxonomy-grid">
                    <div className="article-template-inline-field"><GlassSelect ariaLabel={phrase("分类", "Category")} leadingIcon={<Shapes aria-hidden="true" size={15} />} onChange={(category) => updateForm("category", category)} options={categoryOptions.map((category) => ({ value: category, label: displayArticleTaxonomy(category, locale) }))} value={form.category} /></div>
                    <div className="article-template-tag-picker" ref={tagPickerRef}>
                      <button aria-expanded={isTagPickerOpen} className="article-tag-picker-trigger" onClick={() => setIsTagPickerOpen((current) => !current)} type="button"><Tags aria-hidden="true" size={15} /><span className={`article-tag-picker-values${selectedTags.length ? " selected" : ""}`}>{selectedTags.length ? selectedTags.map((tag) => <span key={tag}>#{displayArticleTaxonomy(tag, locale)}</span>) : phrase("选择标签", "Choose tags")}</span><ChevronDown aria-hidden="true" size={15} /></button>
                      {isTagPickerOpen ? <div className="article-tag-picker-menu">{tagOptions.map((tag) => { const selected = selectedTags.includes(tag); return <button aria-pressed={selected} className={selected ? "selected" : undefined} key={tag} onClick={() => toggleTag(tag)} type="button"><span>{displayArticleTaxonomy(tag, locale)}</span>{selected ? <Check aria-hidden="true" size={14} /> : null}</button>; })}</div> : null}
                    </div>
                    <div className="article-template-inline-field"><GlassSelect ariaLabel={phrase("阅读权限", "Visibility")} leadingIcon={<Eye aria-hidden="true" size={15} />} onChange={(value) => updateForm("visibility", value)} options={visibilityLabels} value={form.visibility} /></div>
                  </div>
                  {form.visibility === "role_restricted" ? <label className="wide"><span>{phrase("可见角色", "Visible roles")}</span><input onChange={(event) => updateForm("roleCodes", event.target.value)} placeholder={phrase("用逗号分隔角色代码", "Comma separated role codes")} value={form.roleCodes} /></label> : null}
                  <label className="wide article-template-content-field"><textarea aria-label={phrase("模板正文", "Template content")} minLength={1} onChange={(event) => updateForm("content", event.target.value)} placeholder={phrase("模板正文，支持 Markdown", "Template content, Markdown supported")} required value={form.content} /></label>
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

function parseArticleTags(value: string): string[] {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
}
