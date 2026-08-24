"use client";

import Image from "next/image";
import { ImagePlus, Layers3, Plus, Save, Trash2, X } from "lucide-react";
import { type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ContentArticleManager, type ManageableArticle } from "@/components/content-article-manager";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import type { AuthRole } from "@/lib/auth-api";
import { resolveApiUrl } from "@/lib/auth-api";
import type { ArticleTopicInput } from "@/lib/discovery-api";

export interface TopicEditorDraft extends ArticleTopicInput {
  coverPath: string;
}

export function TopicEditorDialog({
  articles,
  coverFile,
  coverPreview,
  draft,
  isEdit,
  isSaving,
  onChange,
  onClose,
  onCoverFileChange,
  onDelete,
  onReorderArticles,
  onSubmit,
  onToggleArticle,
  roles,
  selectedArticles,
}: {
  articles: ManageableArticle[];
  coverFile: File | null;
  coverPreview: string;
  draft: TopicEditorDraft;
  isEdit: boolean;
  isSaving: boolean;
  onChange: (next: TopicEditorDraft) => void;
  onClose: () => void;
  onCoverFileChange: (file: File | null) => void;
  onDelete?: () => void;
  onReorderArticles: (ids: number[]) => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleArticle: (articleId: number, included: boolean) => Promise<void>;
  roles: AuthRole[];
  selectedArticles: ManageableArticle[];
}) {
  const { phrase } = useLanguage();
  if (typeof document === "undefined") return null;
  const title = isEdit ? phrase("编辑专题", "Edit topic") : phrase("创建专题", "Create topic");
  const topicVisibilityOptions = [
    { label: phrase("公开", "Public"), value: "public" },
    { label: phrase("登录可见", "Signed-in users"), value: "authenticated" },
    { label: phrase("指定角色", "Specific roles"), value: "role_restricted" },
  ] as const;
  const topicStatusOptions = [
    { label: phrase("启用", "Active"), value: "active" },
    { label: phrase("停用", "Disabled"), value: "disabled" },
  ] as const;
  const resolvedCover = coverPreview || (draft.coverPath ? resolveApiUrl(draft.coverPath) : "");

  function toggleRole(code: string) {
    onChange({
      ...draft,
      roleCodes: draft.roleCodes.includes(code)
        ? draft.roleCodes.filter((item) => item !== code)
        : [...draft.roleCodes, code],
    });
  }

  return createPortal(
    <div className="modal-backdrop modal-backdrop--light collection-editor-backdrop topic-editor-backdrop" role="presentation">
      <form aria-modal="true" className="chat-add-friend-dialog collection-editor-dialog topic-editor-dialog" onSubmit={onSubmit} role="dialog">
        <header>
          <span><Layers3 aria-hidden="true" size={18} /><strong>{title}</strong></span>
          <button aria-label={phrase("关闭", "Close")} disabled={isSaving} onClick={onClose} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <main>
          <div className="collection-form-grid topic-editor-form-grid">
            <label><span>{phrase("专题名称", "Topic name")}</span><input autoFocus maxLength={80} onChange={(event) => onChange({ ...draft, title: event.target.value })} required value={draft.title} /></label>
            <label><span>{phrase("路径标识", "Path identifier")}</span><input maxLength={120} onChange={(event) => onChange({ ...draft, slug: event.target.value })} placeholder={phrase("留空自动生成", "Leave blank to generate automatically")} value={draft.slug} /></label>
            <label><span>{phrase("可见范围", "Visibility")}</span><GlassSelect ariaLabel={phrase("专题可见范围", "Topic visibility")} disabled={isSaving} onChange={(value) => onChange({ ...draft, visibility: value })} options={topicVisibilityOptions} value={draft.visibility} /></label>
            <label><span>{phrase("状态", "Status")}</span><GlassSelect ariaLabel={phrase("专题状态", "Topic status")} disabled={isSaving} onChange={(value) => onChange({ ...draft, status: value })} options={topicStatusOptions} value={draft.status} /></label>
            <label><span>{phrase("排序", "Sort order")}</span><input min={0} onChange={(event) => onChange({ ...draft, sortOrder: Number(event.target.value) })} type="number" value={draft.sortOrder} /></label>
            <label className="wide"><span>{phrase("封面图片地址", "Cover image URL")}</span><input maxLength={512} onChange={(event) => { onChange({ ...draft, coverPath: event.target.value }); if (event.target.value) onCoverFileChange(null); }} placeholder="https://example.com/topic-cover.webp" value={draft.coverPath} /></label>
            <label className="wide"><span>{phrase("专题说明", "Topic description")}</span><textarea maxLength={500} onChange={(event) => onChange({ ...draft, description: event.target.value })} rows={3} value={draft.description} /></label>
          </div>
          <div className="collection-editor-cover-control topic-editor-cover-control">
            <div className="collection-cover-preview">{resolvedCover ? <Image alt={phrase("专题封面预览", "Topic cover preview")} height={258} src={resolvedCover} unoptimized width={344} /> : <Layers3 aria-hidden="true" size={28} />}</div>
            <span><strong>{coverFile?.name || phrase("本地封面", "Local cover")}</strong><small>{phrase("支持 JPEG、PNG、WebP、AVIF，最大 10 MB；本地图片优先于图片地址。", "JPEG, PNG, WebP, and AVIF up to 10 MB. A local image overrides the image URL.")}</small></span>
            <label title={phrase("选择本地封面", "Choose local cover")}><ImagePlus aria-hidden="true" size={16} /><span>{phrase("上传图片", "Upload image")}</span><input accept="image/jpeg,image/png,image/webp,image/avif" disabled={isSaving} onChange={(event) => { onCoverFileChange(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} type="file" /></label>
          </div>
          {draft.visibility === "role_restricted" ? (
            <div className="topic-role-grid">
              {roles.map((role) => (
                <label key={role.code}><input checked={draft.roleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} type="checkbox" />{role.name}</label>
              ))}
            </div>
          ) : null}
          <ContentArticleManager articles={articles} noun={phrase("专题", "topic")} onReorder={onReorderArticles} onToggle={onToggleArticle} selectedArticles={selectedArticles} />
        </main>
        <footer>
          {onDelete ? <button className="danger" disabled={isSaving} onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={15} />{phrase("删除专题", "Delete topic")}</button> : <span />}
          <button disabled={isSaving || !draft.title.trim()} type="submit">{isEdit ? <Save aria-hidden="true" size={15} /> : <Plus aria-hidden="true" size={15} />}{isSaving ? phrase("处理中", "Working") : isEdit ? phrase("保存专题", "Save topic") : phrase("创建专题", "Create topic")}</button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
