"use client";

import {
  Bell,
  Check,
  FileText,
  Globe2,
  Package,
  Plus,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { listRoles } from "@/lib/admin-api";
import { type AuthRole, type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  type ArticleTaxonomy,
  type ArticleTaxonomyInput,
  type ArticleTaxonomyKind,
  type SiteSettings,
  type SiteSettingsInput,
  createArticleTaxonomy,
  deleteArticleTaxonomy,
  getAdminSiteSettings,
  siteSettingsToInput,
  updateArticleTaxonomy,
  updateSiteSettings,
} from "@/lib/site-settings-api";
import { portalThemes, type ThemeId } from "@/lib/theme-preferences";

const VISIBILITY_OPTIONS = [
  { value: "public", label: "公开" },
  { value: "authenticated", label: "登录可见" },
  { value: "role_restricted", label: "指定角色" },
  { value: "private", label: "仅自己" },
] as const;

const notificationRows = [
  ["notifyArticleLiked", "文章点赞"],
  ["notifyArticleFavorited", "文章收藏"],
  ["notifyArticleCommented", "文章评论"],
  ["notifyCommentReplied", "评论回复"],
  ["notifyAuthorSubscribed", "新增订阅者"],
  ["notifySubscriptionPublished", "订阅作者发布"],
  ["notifyFriendRequest", "好友申请"],
  ["notifyCommentReport", "举报处理"],
  ["notifySystem", "系统消息"],
] as const;

const templateRows = [
  ["templateArticleLiked", "点赞模板"],
  ["templateArticleFavorited", "收藏模板"],
  ["templateArticleCommented", "评论模板"],
  ["templateCommentReplied", "回复模板"],
  ["templateAuthorSubscribed", "订阅者模板"],
  ["templateSubscriptionPublished", "订阅发布模板"],
  ["templateFriendRequest", "好友申请模板"],
  ["templateCommentReportHandled", "举报结果模板"],
  ["templateCommentAuthorModerated", "评论处理模板"],
] as const;

const emptyTaxonomyDraft: ArticleTaxonomyInput = {
  kind: "category",
  name: "",
  color: "#7c8faa",
  sortOrder: 0,
  enabled: true,
};

export default function SiteSettingsPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [draft, setDraft] = useState<SiteSettingsInput | null>(null);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [taxonomyDrafts, setTaxonomyDrafts] = useState<Record<number, ArticleTaxonomyInput>>({});
  const [newTaxonomy, setNewTaxonomy] = useState<ArticleTaxonomyInput>(emptyTaxonomyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyTaxonomyId, setBusyTaxonomyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    async function loadSettings(verifiedToken: string) {
      setError("");
      try {
        const me = await getMe(verifiedToken);
        if (!isMounted) return;
        setAccessToken(verifiedToken);
        setCurrentUser(me);
        if (!me.isSuperAdmin) return;

        const [nextSettings, nextRoles] = await Promise.all([
          getAdminSiteSettings(verifiedToken),
          listRoles(),
        ]);
        if (!isMounted) return;
        applySettings(nextSettings);
        setRoles(nextRoles);
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        if (isMounted) setError(loadError instanceof Error ? loadError.message : "无法读取站点设置。");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSettings(token);
    return () => {
      isMounted = false;
    };
  }, [router]);

  const categories = settings?.taxonomies.categories ?? [];
  const tags = settings?.taxonomies.tags ?? [];
  const roleOptions = useMemo(
    () => roles.filter((role) => role.level < 90),
    [roles],
  );

  function applySettings(nextSettings: SiteSettings) {
    setSettings(nextSettings);
    setDraft(siteSettingsToInput(nextSettings));
    setTaxonomyDrafts(Object.fromEntries(
      [...nextSettings.taxonomies.categories, ...nextSettings.taxonomies.tags].map((taxonomy) => [
        taxonomy.id,
        toTaxonomyInput(taxonomy),
      ]),
    ));
  }

  function updateDraft(patch: Partial<SiteSettingsInput>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !draft) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await updateSiteSettings(accessToken, draft);
      applySettings(saved);
      setNotice("站点设置已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "站点设置保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateTaxonomy(kind: ArticleTaxonomyKind) {
    if (!accessToken) return;
    const payload = { ...newTaxonomy, kind, name: newTaxonomy.name.trim() };
    if (!payload.name) {
      setError("分类或标签名称不能为空。");
      return;
    }
    setBusyTaxonomyId(0);
    setError("");
    setNotice("");
    try {
      await createArticleTaxonomy(accessToken, payload);
      const refreshed = await getAdminSiteSettings(accessToken);
      applySettings(refreshed);
      setNewTaxonomy({ ...emptyTaxonomyDraft, kind });
      setNotice(kind === "category" ? "分类已新增。" : "标签已新增。");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新增失败。");
    } finally {
      setBusyTaxonomyId(null);
    }
  }

  async function handleUpdateTaxonomy(taxonomy: ArticleTaxonomy) {
    if (!accessToken) return;
    const payload = taxonomyDrafts[taxonomy.id];
    if (!payload?.name.trim()) {
      setError("分类或标签名称不能为空。");
      return;
    }
    setBusyTaxonomyId(taxonomy.id);
    setError("");
    setNotice("");
    try {
      await updateArticleTaxonomy(accessToken, taxonomy.id, { ...payload, name: payload.name.trim() });
      const refreshed = await getAdminSiteSettings(accessToken);
      applySettings(refreshed);
      setNotice("分类或标签已更新。");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "更新失败。");
    } finally {
      setBusyTaxonomyId(null);
    }
  }

  async function handleDeleteTaxonomy(taxonomy: ArticleTaxonomy) {
    if (!accessToken || !window.confirm(`确定删除“${taxonomy.name}”吗？已有文章中的文字分类或标签不会被删除。`)) return;
    setBusyTaxonomyId(taxonomy.id);
    setError("");
    setNotice("");
    try {
      await deleteArticleTaxonomy(accessToken, taxonomy.id);
      const refreshed = await getAdminSiteSettings(accessToken);
      applySettings(refreshed);
      setNotice("分类或标签已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败。");
    } finally {
      setBusyTaxonomyId(null);
    }
  }

  function updateTaxonomyDraft(id: number, patch: Partial<ArticleTaxonomyInput>) {
    setTaxonomyDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  if (isLoading) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>站点设置</h1>
        <div className="status-row"><span className="status">正在读取设置</span></div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无法进入站点设置</h1>
        <p>{error || "请重新登录后访问。"}</p>
        <Link className="text-action primary" href="/login">返回登录</Link>
      </section>
    );
  }

  if (!currentUser.isSuperAdmin || !draft) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无权访问</h1>
        <p>该页面仅超级管理员可以查看和修改。</p>
        <Link className="text-action primary" href="/dashboard">返回工作台</Link>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell site-settings-shell">
      <AppToast
        duration={error ? 4200 : 2600}
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />

      <form className="site-settings-form" onSubmit={(event) => void handleSettingsSubmit(event)}>
        <div className="site-settings-head">
          <div>
            <span className="section-label">HLOVET Admin</span>
            <h1>站点设置中心</h1>
          </div>
          <button className="button site-settings-save" disabled={isSaving} type="submit">
            {isSaving ? <Settings2 aria-hidden="true" className="spin" size={16} /> : <Save aria-hidden="true" size={16} />}
            {isSaving ? "保存中" : "保存设置"}
          </button>
        </div>

        <div className="site-settings-grid">
          <section className="site-settings-card">
            <PanelTitle icon={Globe2} label="站点基础" />
            <div className="site-settings-field-grid">
              <label><span>网站名称</span><input maxLength={80} onChange={(event) => updateDraft({ siteName: event.target.value })} value={draft.siteName} /></label>
              <label><span>浏览器标题</span><input maxLength={120} onChange={(event) => updateDraft({ browserTitle: event.target.value })} value={draft.browserTitle} /></label>
              <label><span>Logo 路径</span><input maxLength={512} onChange={(event) => updateDraft({ logoPath: event.target.value })} value={draft.logoPath} /></label>
              <label><span>PWA 图标路径</span><input maxLength={512} onChange={(event) => updateDraft({ pwaIconPath: event.target.value })} value={draft.pwaIconPath} /></label>
              <label className="wide"><span>默认背景路径</span><input maxLength={512} onChange={(event) => updateDraft({ defaultBackgroundUrl: event.target.value })} value={draft.defaultBackgroundUrl} /></label>
              <label><span>开放注册</span><select onChange={(event) => updateDraft({ registrationOpen: event.target.value === "true" })} value={String(draft.registrationOpen)}><option value="true">开放</option><option value="false">关闭</option></select></label>
              <label><span>默认角色</span><select onChange={(event) => updateDraft({ defaultRoleCode: event.target.value })} value={draft.defaultRoleCode}>{roleOptions.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}</select></label>
            </div>
          </section>

          <section className="site-settings-card">
            <PanelTitle icon={Settings2} label="默认主题" />
            <div className="site-settings-field-grid">
              <label><span>主题</span><select onChange={(event) => updateDraft({ defaultThemeId: event.target.value as ThemeId })} value={draft.defaultThemeId}>{portalThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}<option value="custom">自定义</option></select></label>
              <ColorField label="强调色" value={draft.defaultAccent} onChange={(value) => updateDraft({ defaultAccent: value })} />
              <ColorField label="卡片颜色" value={draft.defaultSurface} onChange={(value) => updateDraft({ defaultSurface: value })} />
              <ColorField label="文字颜色" value={draft.defaultForeground} onChange={(value) => updateDraft({ defaultForeground: value })} />
              <ColorField label="弱文字色" value={draft.defaultMuted} onChange={(value) => updateDraft({ defaultMuted: value })} />
              <ColorField label="磨砂颜色" value={draft.defaultGlassTint} onChange={(value) => updateDraft({ defaultGlassTint: value })} />
              <RangeField label="卡片透明度" max={76} min={38} value={draft.defaultCardAlpha} onChange={(value) => updateDraft({ defaultCardAlpha: value })} />
              <RangeField label="磨砂程度" max={36} min={0} value={draft.defaultGlassBlur} onChange={(value) => updateDraft({ defaultGlassBlur: value })} />
              <RangeField label="磨砂遮罩" max={100} min={0} value={draft.defaultGlassTintAlpha} onChange={(value) => updateDraft({ defaultGlassTintAlpha: value })} />
            </div>
          </section>

          <section className="site-settings-card">
            <PanelTitle icon={Package} label="安装包设置" />
            <div className="site-settings-field-grid">
              <label><span>安装页</span><select onChange={(event) => updateDraft({ installPageEnabled: event.target.value === "true" })} value={String(draft.installPageEnabled)}><option value="true">启用</option><option value="false">关闭</option></select></label>
              <label><span>保留历史版本</span><select onChange={(event) => updateDraft({ apkHistoryEnabled: event.target.value === "true" })} value={String(draft.apkHistoryEnabled)}><option value="true">保留</option><option value="false">只保留最新版</option></select></label>
              <label><span>自动清理旧版</span><select onChange={(event) => updateDraft({ apkAutoCleanupEnabled: event.target.value === "true" })} value={String(draft.apkAutoCleanupEnabled)}><option value="false">手动清理</option><option value="true">自动清理</option></select></label>
              <label><span>最多保留</span><input max={20} min={1} onChange={(event) => updateDraft({ apkRetentionCount: Number(event.target.value) })} type="number" value={draft.apkRetentionCount} /></label>
            </div>
            <Link className="text-action primary site-settings-inline-link" href="/admin/android">进入安装包管理</Link>
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={FileText} label="内容发布设置" />
            <div className="site-settings-field-grid compact">
              <label><span>默认阅读权限</span><select onChange={(event) => updateDraft({ defaultArticleVisibility: event.target.value as SiteSettingsInput["defaultArticleVisibility"] })} value={draft.defaultArticleVisibility}>{VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label><span>图片上限 MB</span><input max={30} min={1} onChange={(event) => updateDraft({ articleImageMaxSizeMb: Number(event.target.value) })} type="number" value={draft.articleImageMaxSizeMb} /></label>
              <label><span>评论</span><select onChange={(event) => updateDraft({ commentsEnabled: event.target.value === "true" })} value={String(draft.commentsEnabled)}><option value="true">开启</option><option value="false">关闭</option></select></label>
              <label><span>举报</span><select onChange={(event) => updateDraft({ reportsEnabled: event.target.value === "true" })} value={String(draft.reportsEnabled)}><option value="true">开启</option><option value="false">关闭</option></select></label>
            </div>
            <div className="taxonomy-panels">
              <TaxonomyPanel
                busyId={busyTaxonomyId}
                drafts={taxonomyDrafts}
                items={categories}
                kind="category"
                newDraft={newTaxonomy.kind === "category" ? newTaxonomy : { ...newTaxonomy, kind: "category" }}
                onCreate={() => void handleCreateTaxonomy("category")}
                onDelete={(taxonomy) => void handleDeleteTaxonomy(taxonomy)}
                onDraftChange={updateTaxonomyDraft}
                onNewDraftChange={(patch) => setNewTaxonomy((current) => ({ ...current, kind: "category", ...patch }))}
                onUpdate={(taxonomy) => void handleUpdateTaxonomy(taxonomy)}
                title="文章分类"
              />
              <TaxonomyPanel
                busyId={busyTaxonomyId}
                drafts={taxonomyDrafts}
                items={tags}
                kind="tag"
                newDraft={newTaxonomy.kind === "tag" ? newTaxonomy : { ...newTaxonomy, kind: "tag" }}
                onCreate={() => void handleCreateTaxonomy("tag")}
                onDelete={(taxonomy) => void handleDeleteTaxonomy(taxonomy)}
                onDraftChange={updateTaxonomyDraft}
                onNewDraftChange={(patch) => setNewTaxonomy((current) => ({ ...current, kind: "tag", ...patch }))}
                onUpdate={(taxonomy) => void handleUpdateTaxonomy(taxonomy)}
                title="文章标签"
              />
            </div>
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={Bell} label="通知设置" />
            <div className="notification-toggle-grid">
              {notificationRows.map(([key, label]) => (
                <label key={key}>
                  <input
                    checked={Boolean(draft[key])}
                    onChange={(event) => updateDraft({ [key]: event.target.checked } as Partial<SiteSettingsInput>)}
                    type="checkbox"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="notification-template-grid">
              {templateRows.map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    maxLength={240}
                    onChange={(event) => updateDraft({ [key]: event.target.value } as Partial<SiteSettingsInput>)}
                    value={String(draft[key])}
                  />
                </label>
              ))}
            </div>
            <p className="site-settings-hint">模板支持变量：{"{actor}"}、{"{author}"}、{"{article}"}、{"{comment}"}、{"{result}"}、{"{count}"}。</p>
          </section>
        </div>
      </form>
    </section>
  );
}

function PanelTitle({ icon: Icon, label }: { icon: typeof Globe2; label: string }) {
  return (
    <div className="site-settings-panel-title">
      <span><Icon aria-hidden="true" size={18} /></span>
      <strong>{label}</strong>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{label}</span>
      <span className="site-color-input">
        <input aria-label={label} onChange={(event) => onChange(event.target.value)} type="color" value={value} />
        <input maxLength={7} onChange={(event) => onChange(event.target.value)} value={value} />
      </span>
    </label>
  );
}

function RangeField({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label>
      <span>{label} · {value}</span>
      <input max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} type="range" value={value} />
    </label>
  );
}

function TaxonomyPanel({
  busyId,
  drafts,
  items,
  kind,
  newDraft,
  onCreate,
  onDelete,
  onDraftChange,
  onNewDraftChange,
  onUpdate,
  title,
}: {
  busyId: number | null;
  drafts: Record<number, ArticleTaxonomyInput>;
  items: ArticleTaxonomy[];
  kind: ArticleTaxonomyKind;
  newDraft: ArticleTaxonomyInput;
  onCreate: () => void;
  onDelete: (taxonomy: ArticleTaxonomy) => void;
  onDraftChange: (id: number, patch: Partial<ArticleTaxonomyInput>) => void;
  onNewDraftChange: (patch: Partial<ArticleTaxonomyInput>) => void;
  onUpdate: (taxonomy: ArticleTaxonomy) => void;
  title: string;
}) {
  return (
    <div className="taxonomy-panel">
      <div className="taxonomy-panel-head">
        <strong>{title}</strong>
        <span>{items.length} 项</span>
      </div>
      <div className="taxonomy-create-row">
        <input maxLength={80} onChange={(event) => onNewDraftChange({ name: event.target.value })} placeholder={`新增${kind === "category" ? "分类" : "标签"}`} value={newDraft.name} />
        <input aria-label="颜色" onChange={(event) => onNewDraftChange({ color: event.target.value })} type="color" value={newDraft.color} />
        <button className="text-action primary" disabled={busyId === 0} onClick={onCreate} type="button"><Plus aria-hidden="true" size={15} />新增</button>
      </div>
      <div className="taxonomy-list">
        {items.map((taxonomy) => {
          const draft = drafts[taxonomy.id] ?? toTaxonomyInput(taxonomy);
          const isBusy = busyId === taxonomy.id;
          return (
            <article className="taxonomy-row" key={taxonomy.id}>
              <span className="taxonomy-color-dot" style={{ background: draft.color }} />
              <input maxLength={80} onChange={(event) => onDraftChange(taxonomy.id, { name: event.target.value })} value={draft.name} />
              <input aria-label={`${taxonomy.name} 颜色`} onChange={(event) => onDraftChange(taxonomy.id, { color: event.target.value })} type="color" value={draft.color} />
              <input aria-label={`${taxonomy.name} 排序`} min={0} onChange={(event) => onDraftChange(taxonomy.id, { sortOrder: Number(event.target.value) })} type="number" value={draft.sortOrder} />
              <label className="taxonomy-enabled"><input checked={draft.enabled} onChange={(event) => onDraftChange(taxonomy.id, { enabled: event.target.checked })} type="checkbox" />启用</label>
              <div className="taxonomy-actions">
                <button aria-label={`保存 ${taxonomy.name}`} disabled={isBusy} onClick={() => onUpdate(taxonomy)} title="保存" type="button"><Check aria-hidden="true" size={15} /></button>
                <button aria-label={`删除 ${taxonomy.name}`} disabled={isBusy} onClick={() => onDelete(taxonomy)} title="删除" type="button"><Trash2 aria-hidden="true" size={15} /></button>
              </div>
            </article>
          );
        })}
        {!items.length ? <p className="taxonomy-empty">还没有配置内容。</p> : null}
      </div>
    </div>
  );
}

function toTaxonomyInput(taxonomy: ArticleTaxonomy): ArticleTaxonomyInput {
  return {
    kind: taxonomy.kind,
    name: taxonomy.name,
    color: taxonomy.color,
    sortOrder: taxonomy.sortOrder,
    enabled: taxonomy.enabled,
  };
}
