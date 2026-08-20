"use client";

import Image from "next/image";
import { ImagePlus, Layers3, Plus, Save, Trash2, X } from "lucide-react";
import { type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ContentArticleManager, type ManageableArticle } from "@/components/content-article-manager";
import { GlassSelect } from "@/components/glass-select";
import type { AuthRole } from "@/lib/auth-api";
import { resolveApiUrl } from "@/lib/auth-api";
import type { ArticleTopicInput } from "@/lib/discovery-api";

const TOPIC_VISIBILITY_OPTIONS = [
  { label: "公开", value: "public" },
  { label: "登录可见", value: "authenticated" },
  { label: "指定角色", value: "role_restricted" },
] as const;

const TOPIC_STATUS_OPTIONS = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
] as const;

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
  if (typeof document === "undefined") return null;
  const title = isEdit ? "编辑专题" : "创建专题";
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
          <button aria-label="关闭" disabled={isSaving} onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <main>
          <div className="collection-form-grid topic-editor-form-grid">
            <label><span>专题名称</span><input autoFocus maxLength={80} onChange={(event) => onChange({ ...draft, title: event.target.value })} required value={draft.title} /></label>
            <label><span>路径标识</span><input maxLength={120} onChange={(event) => onChange({ ...draft, slug: event.target.value })} placeholder="留空自动生成" value={draft.slug} /></label>
            <label><span>可见范围</span><GlassSelect ariaLabel="专题可见范围" disabled={isSaving} onChange={(value) => onChange({ ...draft, visibility: value })} options={TOPIC_VISIBILITY_OPTIONS} value={draft.visibility} /></label>
            <label><span>状态</span><GlassSelect ariaLabel="专题状态" disabled={isSaving} onChange={(value) => onChange({ ...draft, status: value })} options={TOPIC_STATUS_OPTIONS} value={draft.status} /></label>
            <label><span>排序</span><input min={0} onChange={(event) => onChange({ ...draft, sortOrder: Number(event.target.value) })} type="number" value={draft.sortOrder} /></label>
            <label className="wide"><span>封面图片地址</span><input maxLength={512} onChange={(event) => { onChange({ ...draft, coverPath: event.target.value }); if (event.target.value) onCoverFileChange(null); }} placeholder="https://example.com/topic-cover.webp" value={draft.coverPath} /></label>
            <label className="wide"><span>专题说明</span><textarea maxLength={500} onChange={(event) => onChange({ ...draft, description: event.target.value })} rows={3} value={draft.description} /></label>
          </div>
          <div className="collection-editor-cover-control topic-editor-cover-control">
            <div className="collection-cover-preview">{resolvedCover ? <Image alt="专题封面预览" height={258} src={resolvedCover} unoptimized width={344} /> : <Layers3 aria-hidden="true" size={28} />}</div>
            <span><strong>{coverFile?.name || "本地封面"}</strong><small>支持 JPEG、PNG、WebP、AVIF，最大 10 MB；本地图片优先于图片地址。</small></span>
            <label title="选择本地封面"><ImagePlus aria-hidden="true" size={16} /><span>上传图片</span><input accept="image/jpeg,image/png,image/webp,image/avif" disabled={isSaving} onChange={(event) => { onCoverFileChange(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} type="file" /></label>
          </div>
          {draft.visibility === "role_restricted" ? (
            <div className="topic-role-grid">
              {roles.map((role) => (
                <label key={role.code}><input checked={draft.roleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} type="checkbox" />{role.name}</label>
              ))}
            </div>
          ) : null}
          <ContentArticleManager articles={articles} noun="专题" onReorder={onReorderArticles} onToggle={onToggleArticle} selectedArticles={selectedArticles} />
        </main>
        <footer>
          {onDelete ? <button className="danger" disabled={isSaving} onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={15} />删除专题</button> : <span />}
          <button disabled={isSaving || !draft.title.trim()} type="submit">{isEdit ? <Save aria-hidden="true" size={15} /> : <Plus aria-hidden="true" size={15} />}{isSaving ? "处理中" : isEdit ? "保存专题" : "创建专题"}</button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
