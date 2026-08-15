"use client";

import {
  Bell,
  Check,
  Eye,
  FileText,
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  Package,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { listRoles } from "@/lib/admin-api";
import { type AuthRole, type AuthUser, getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  activateBackground,
  clearActiveBackground,
  deleteBackground,
  listBackgrounds,
  type ManagedBackground,
  notifyBackgroundChange,
  resolveBackgroundUrl,
  uploadBackgrounds,
} from "@/lib/background-api";
import {
  type ArticleTaxonomy,
  type ArticleTaxonomyInput,
  type ArticleTaxonomyKind,
  type SiteAsset,
  type SiteAssetKind,
  type SiteSettings,
  type SiteSettingsInput,
  createArticleTaxonomy,
  deleteArticleTaxonomy,
  deleteSiteAsset,
  getAdminSiteSettings,
  listSiteAssets,
  resetSiteSettings,
  resolveSiteAssetUrl,
  siteSettingsToInput,
  toConfiguredApiAssetPath,
  updateArticleTaxonomy,
  updateSiteSettings,
  uploadSiteAsset,
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

const MAX_SITE_ASSET_SIZE = 5 * 1024 * 1024;
const MAX_BACKGROUND_FILE_SIZE = 30 * 1024 * 1024;
const MAX_BACKGROUND_FILES = 20;

const BUILTIN_LOGO_OPTIONS = [
  { label: "默认 SVG", path: "/favicon.svg" },
  { label: "HLOVET Logo", path: "/logo.svg" },
  { label: "页签图标", path: "/tab-icon.svg" },
  { label: "PNG Logo", path: "/logo.png" },
] as const;

const BUILTIN_PWA_ICON_OPTIONS = [
  { label: "Logo 图标", path: "/pwa-logo.png" },
  { label: "192 图标", path: "/icon-192.png" },
  { label: "512 图标", path: "/icon-512.png" },
  { label: "Apple 图标", path: "/apple-touch-icon.png" },
] as const;

const BUILTIN_BACKGROUND_OPTIONS = [
  { label: "浅云蓝白", path: "/images/hlovet-cloud-blue.jpeg" },
  { label: "城市灯火", path: "/images/hlovet-city-lights.jpg" },
] as const;

export default function SiteSettingsPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [draft, setDraft] = useState<SiteSettingsInput | null>(null);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [siteAssets, setSiteAssets] = useState<SiteAsset[]>([]);
  const [backgrounds, setBackgrounds] = useState<ManagedBackground[]>([]);
  const [assetUploadKind, setAssetUploadKind] = useState<SiteAssetKind | null>(null);
  const [backgroundUploadFiles, setBackgroundUploadFiles] = useState<File[]>([]);
  const [previewBackground, setPreviewBackground] = useState<ManagedBackground | null>(null);
  const [taxonomyDrafts, setTaxonomyDrafts] = useState<Record<number, ArticleTaxonomyInput>>({});
  const [newTaxonomy, setNewTaxonomy] = useState<ArticleTaxonomyInput>(emptyTaxonomyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackgroundUploading, setIsBackgroundUploading] = useState(false);
  const [busyBackgroundId, setBusyBackgroundId] = useState<number | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<number | null>(null);
  const [busyTaxonomyId, setBusyTaxonomyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingSettingsPatchRef = useRef<Partial<SiteSettingsInput>>({});
  const settingsSaveTimerRef = useRef<number | null>(null);
  const settingsSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveCountRef = useRef(0);

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

        const [nextSettings, nextRoles, nextAssets, nextBackgrounds] = await Promise.all([
          getAdminSiteSettings(verifiedToken),
          listRoles(),
          listSiteAssets(verifiedToken),
          listBackgrounds(verifiedToken),
        ]);
        if (!isMounted) return;
        applySettings(nextSettings);
        setRoles(nextRoles);
        setSiteAssets(nextAssets);
        setBackgrounds(nextBackgrounds);
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

  useEffect(() => () => {
    if (settingsSaveTimerRef.current !== null) {
      window.clearTimeout(settingsSaveTimerRef.current);
    }
  }, []);

  const categories = settings?.taxonomies.categories ?? [];
  const tags = settings?.taxonomies.tags ?? [];
  const logoAssets = useMemo(() => siteAssets.filter((asset) => asset.kind === "logo"), [siteAssets]);
  const pwaIconAssets = useMemo(() => siteAssets.filter((asset) => asset.kind === "pwa_icon"), [siteAssets]);
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

  function updateDraft(patch: Partial<SiteSettingsInput>, immediate = false) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    pendingSettingsPatchRef.current = { ...pendingSettingsPatchRef.current, ...patch };
    if (!Object.keys(partitionSettingsPatch(pendingSettingsPatchRef.current).ready).length) return;

    if (settingsSaveTimerRef.current !== null) {
      window.clearTimeout(settingsSaveTimerRef.current);
    }
    if (immediate) {
      settingsSaveTimerRef.current = null;
      flushSettingsPatch();
      return;
    }
    settingsSaveTimerRef.current = window.setTimeout(() => {
      settingsSaveTimerRef.current = null;
      flushSettingsPatch();
    }, 520);
  }

  function flushSettingsPatch() {
    if (!accessToken || !Object.keys(pendingSettingsPatchRef.current).length) return;
    const { pending, ready: patch } = partitionSettingsPatch(pendingSettingsPatchRef.current);
    if (!Object.keys(patch).length) return;
    pendingSettingsPatchRef.current = pending;
    settingsSaveCountRef.current += 1;
    setIsSaving(true);

    settingsSaveChainRef.current = settingsSaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await updateSiteSettings(accessToken, patch);
        setSettings(saved);
      })
      .catch((saveError) => {
        pendingSettingsPatchRef.current = { ...patch, ...pendingSettingsPatchRef.current };
        setError(saveError instanceof Error ? saveError.message : "站点设置自动保存失败。");
      })
      .finally(() => {
        settingsSaveCountRef.current = Math.max(0, settingsSaveCountRef.current - 1);
        if (settingsSaveCountRef.current === 0) setIsSaving(false);
      });
  }

  async function handleResetSettings() {
    if (!accessToken || !window.confirm("恢复默认站点设置吗？已上传的资源、背景图片、文章分类和标签不会删除。")) return;
    if (settingsSaveTimerRef.current !== null) {
      window.clearTimeout(settingsSaveTimerRef.current);
      settingsSaveTimerRef.current = null;
    }
    pendingSettingsPatchRef.current = {};
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      await settingsSaveChainRef.current.catch(() => undefined);
      await clearActiveBackground(accessToken);
      const restored = await resetSiteSettings(accessToken);
      applySettings(restored);
      setBackgrounds((current) => current.map((background) => ({ ...background, isActive: false })));
      notifyBackgroundChange();
      setNotice("站点设置已恢复默认。");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "恢复默认设置失败。");
    } finally {
      settingsSaveCountRef.current = 0;
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

  async function handleAssetUpload(kind: SiteAssetKind, files: FileList | null) {
    if (!accessToken || !files?.length) return;
    const file = files[0];
    if (file.size > MAX_SITE_ASSET_SIZE) {
      setError("单个站点资源不能超过 5 MB。");
      return;
    }
    setAssetUploadKind(kind);
    setError("");
    setNotice("");
    try {
      const asset = await uploadSiteAsset(accessToken, kind, file);
      setSiteAssets((current) => [asset, ...current]);
      updateDraft({
        [kind === "logo" ? "logoPath" : "pwaIconPath"]: toConfiguredApiAssetPath(asset.url),
      } as Partial<SiteSettingsInput>, true);
      setNotice(kind === "logo" ? "Logo 已上传并应用。" : "PWA 图标已上传并应用。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "站点资源上传失败。");
    } finally {
      setAssetUploadKind(null);
    }
  }

  async function handleDeleteAsset(asset: SiteAsset) {
    const configuredPath = toConfiguredApiAssetPath(asset.url);
    const activePath = asset.kind === "logo" ? draft?.logoPath : draft?.pwaIconPath;
    if (activePath === configuredPath) {
      setError("该资源正在使用，请先选择其他资源后再删除。");
      return;
    }
    if (!accessToken || !window.confirm(`确定永久删除“${asset.originalName}”吗？`)) return;
    setBusyAssetId(asset.id);
    setError("");
    setNotice("");
    try {
      await deleteSiteAsset(accessToken, asset.id);
      setSiteAssets((current) => current.filter((item) => item.id !== asset.id));
      setNotice("站点资源已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "站点资源删除失败。");
    } finally {
      setBusyAssetId(null);
    }
  }

  async function handleBackgroundUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !backgroundUploadFiles.length) {
      setError("请选择背景图片。");
      return;
    }
    if (backgroundUploadFiles.length > MAX_BACKGROUND_FILES) {
      setError(`一次最多上传 ${MAX_BACKGROUND_FILES} 张背景图。`);
      return;
    }
    const oversized = backgroundUploadFiles.find((file) => file.size > MAX_BACKGROUND_FILE_SIZE);
    if (oversized) {
      setError(`${oversized.name} 超过 30 MB。`);
      return;
    }
    setIsBackgroundUploading(true);
    setError("");
    setNotice("");
    try {
      const uploaded = await uploadBackgrounds(accessToken, backgroundUploadFiles);
      setBackgrounds((current) => [...uploaded, ...current]);
      setBackgroundUploadFiles([]);
      setNotice(`${uploaded.length} 张背景图已上传。`);
      const input = document.getElementById("site-background-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "背景图片上传失败。");
    } finally {
      setIsBackgroundUploading(false);
    }
  }

  async function handleDeleteBackground(background: ManagedBackground) {
    if (!accessToken) return;
    const confirmed = window.confirm(
      background.isActive
        ? "删除当前全站背景后将回到设置页选择的内置默认背景，确定删除吗？"
        : `确定从磁盘中永久删除 ${background.originalName} 吗？`,
    );
    if (!confirmed) return;
    setBusyBackgroundId(background.id);
    setError("");
    setNotice("");
    try {
      await deleteBackground(accessToken, background.id);
      setBackgrounds((current) => current.filter((item) => item.id !== background.id));
      if (draft?.defaultBackgroundUrl === toConfiguredApiAssetPath(background.url)) {
        updateDraft({ defaultBackgroundUrl: BUILTIN_BACKGROUND_OPTIONS[0].path }, true);
      }
      if (background.isActive) notifyBackgroundChange();
      setNotice("背景图片及磁盘文件已删除。");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "背景图片删除失败。");
    } finally {
      setBusyBackgroundId(null);
    }
  }

  async function handleUseBackground(background: ManagedBackground) {
    if (!accessToken) return;
    setBusyBackgroundId(background.id);
    setError("");
    setNotice("");
    try {
      const active = await activateBackground(accessToken, background.id);
      const configuredPath = toConfiguredApiAssetPath(active.url);
      setBackgrounds((current) => current.map((item) => ({ ...item, isActive: item.id === active.id })));
      updateDraft({ defaultBackgroundUrl: configuredPath }, true);
      notifyBackgroundChange();
      setNotice("全站背景已切换。");
    } catch (useError) {
      setError(useError instanceof Error ? useError.message : "背景切换失败。");
    } finally {
      setBusyBackgroundId(null);
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

      <div className="site-settings-form">
        <div className="site-settings-head">
          <div>
            <span className="section-label">HLOVET Admin</span>
            <h1>站点设置中心</h1>
          </div>
          <div className="site-settings-head-actions">
            <span className={isSaving ? "saving" : ""}>{isSaving ? "正在自动保存" : "修改后自动保存"}</span>
            <button className="button site-settings-save" disabled={isSaving} onClick={() => void handleResetSettings()} type="button">
              {isSaving ? <Settings2 aria-hidden="true" className="spin" size={16} /> : <RotateCcw aria-hidden="true" size={16} />}
              恢复默认
            </button>
          </div>
        </div>

        <div className="site-settings-grid">
          <section className="site-settings-card">
            <PanelTitle icon={Globe2} label="站点基础" />
            <div className="site-settings-field-grid">
              <label><span>网站名称</span><input maxLength={80} onChange={(event) => updateDraft({ siteName: event.target.value })} value={draft.siteName} /></label>
              <label><span>浏览器标题</span><input maxLength={120} onChange={(event) => updateDraft({ browserTitle: event.target.value })} value={draft.browserTitle} /></label>
              <label><span>开放注册</span><select onChange={(event) => updateDraft({ registrationOpen: event.target.value === "true" }, true)} value={String(draft.registrationOpen)}><option value="true">开放</option><option value="false">关闭</option></select></label>
              <label><span>默认角色</span><select onChange={(event) => updateDraft({ defaultRoleCode: event.target.value }, true)} value={draft.defaultRoleCode}>{roleOptions.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}</select></label>
            </div>
            <div className="site-resource-stack">
              <SiteResourcePicker
                assets={logoAssets}
                busyAssetId={busyAssetId}
                builtins={BUILTIN_LOGO_OPTIONS}
                currentPath={draft.logoPath}
                isUploading={assetUploadKind === "logo"}
                kind="logo"
                label="Logo"
                onDelete={(asset) => void handleDeleteAsset(asset)}
                onSelect={(path) => updateDraft({ logoPath: path }, true)}
                onUpload={(files) => void handleAssetUpload("logo", files)}
              />
              <SiteResourcePicker
                assets={pwaIconAssets}
                busyAssetId={busyAssetId}
                builtins={BUILTIN_PWA_ICON_OPTIONS}
                currentPath={draft.pwaIconPath}
                isUploading={assetUploadKind === "pwa_icon"}
                kind="pwa_icon"
                label="PWA 图标"
                onDelete={(asset) => void handleDeleteAsset(asset)}
                onSelect={(path) => updateDraft({ pwaIconPath: path }, true)}
                onUpload={(files) => void handleAssetUpload("pwa_icon", files)}
              />
            </div>
          </section>

          <section className="site-settings-card">
            <PanelTitle icon={Settings2} label="默认主题" />
            <div className="site-settings-field-grid">
              <label><span>主题</span><select onChange={(event) => updateDraft({ defaultThemeId: event.target.value as ThemeId }, true)} value={draft.defaultThemeId}>{portalThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}<option value="custom">自定义</option></select></label>
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
              <label><span>安装页</span><select onChange={(event) => updateDraft({ installPageEnabled: event.target.value === "true" }, true)} value={String(draft.installPageEnabled)}><option value="true">启用</option><option value="false">关闭</option></select></label>
              <label><span>保留历史版本</span><select onChange={(event) => updateDraft({ apkHistoryEnabled: event.target.value === "true" }, true)} value={String(draft.apkHistoryEnabled)}><option value="true">保留</option><option value="false">只保留最新版</option></select></label>
              <label><span>自动清理旧版</span><select onChange={(event) => updateDraft({ apkAutoCleanupEnabled: event.target.value === "true" }, true)} value={String(draft.apkAutoCleanupEnabled)}><option value="false">手动清理</option><option value="true">自动清理</option></select></label>
              <label><span>最多保留</span><input max={20} min={1} onChange={(event) => updateDraft({ apkRetentionCount: Number(event.target.value) })} type="number" value={draft.apkRetentionCount} /></label>
            </div>
            <Link className="text-action primary site-settings-inline-link" href="/admin/android">进入安装包管理</Link>
          </section>

          <section className="site-settings-card site-settings-summary-card">
            <PanelTitle icon={Sparkles} label="资源状态" />
            <div className="site-settings-summary-grid">
              <SummaryTile label="Logo" value={resourceDisplayName(draft.logoPath, [...BUILTIN_LOGO_OPTIONS], logoAssets)} />
              <SummaryTile label="PWA 图标" value={resourceDisplayName(draft.pwaIconPath, [...BUILTIN_PWA_ICON_OPTIONS], pwaIconAssets)} />
              <SummaryTile label="默认背景" value={backgroundDisplayName(draft.defaultBackgroundUrl, backgrounds)} />
              <SummaryTile label="背景图库" value={`${backgrounds.length} 张`} />
            </div>
            <p className="site-settings-hint">
              默认背景就是新访客和未单独设置主题用户看到的全站背景；点击背景卡片上的“使用”后会立即同步到所有用户。
            </p>
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={ImageIcon} label="背景管理" />
            <div className="site-background-tools">
              <div>
                <strong>默认背景</strong>
                <span>上传自己的背景图片，每次最多 5 张；系统会自动压缩为 WebP，仍可预览、启用或永久删除。</span>
              </div>
              <form className="site-background-upload" onSubmit={(event) => void handleBackgroundUpload(event)}>
                <label htmlFor="site-background-file">
                  <input
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    disabled={isBackgroundUploading}
                    id="site-background-file"
                    multiple
                    onChange={(event) => setBackgroundUploadFiles(Array.from(event.target.files ?? []))}
                    type="file"
                  />
                  <UploadCloud aria-hidden="true" size={16} />
                  <span>{formatSelectedBackgroundFiles(backgroundUploadFiles)}</span>
                </label>
                <button className="text-action primary" disabled={isBackgroundUploading || !backgroundUploadFiles.length} type="submit">
                  {isBackgroundUploading ? "上传中" : "上传"}
                </button>
              </form>
            </div>
            <BackgroundPicker
              backgrounds={backgrounds}
              busyBackgroundId={busyBackgroundId}
              currentPath={draft.defaultBackgroundUrl}
              onDelete={(background) => void handleDeleteBackground(background)}
              onPreview={setPreviewBackground}
              onUse={(background) => void handleUseBackground(background)}
            />
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={FileText} label="内容发布设置" />
            <div className="site-settings-field-grid compact">
              <label><span>默认阅读权限</span><select onChange={(event) => updateDraft({ defaultArticleVisibility: event.target.value as SiteSettingsInput["defaultArticleVisibility"] }, true)} value={draft.defaultArticleVisibility}>{VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label><span>图片上限 MB</span><input max={30} min={1} onChange={(event) => updateDraft({ articleImageMaxSizeMb: Number(event.target.value) })} type="number" value={draft.articleImageMaxSizeMb} /></label>
              <label><span>评论</span><select onChange={(event) => updateDraft({ commentsEnabled: event.target.value === "true" }, true)} value={String(draft.commentsEnabled)}><option value="true">开启</option><option value="false">关闭</option></select></label>
              <label><span>举报</span><select onChange={(event) => updateDraft({ reportsEnabled: event.target.value === "true" }, true)} value={String(draft.reportsEnabled)}><option value="true">开启</option><option value="false">关闭</option></select></label>
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
                    onChange={(event) => updateDraft({ [key]: event.target.checked } as Partial<SiteSettingsInput>, true)}
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
      </div>
      {previewBackground ? <div className="site-background-preview-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setPreviewBackground(null); }} role="presentation">
        <div aria-modal="true" className="site-background-preview-dialog" role="dialog">
          <button aria-label="关闭背景预览" onClick={() => setPreviewBackground(null)} type="button"><X aria-hidden="true" size={20} /></button>
          <img alt={previewBackground.originalName} src={resolveBackgroundUrl(previewBackground)} />
          <strong>{previewBackground.originalName}</strong>
        </div>
      </div> : null}
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

function SiteResourcePicker({
  assets,
  builtins,
  busyAssetId,
  currentPath,
  isUploading,
  kind,
  label,
  onDelete,
  onSelect,
  onUpload,
}: {
  assets: SiteAsset[];
  builtins: ReadonlyArray<{ label: string; path: string }>;
  busyAssetId: number | null;
  currentPath: string;
  isUploading: boolean;
  kind: SiteAssetKind;
  label: string;
  onDelete: (asset: SiteAsset) => void;
  onSelect: (path: string) => void;
  onUpload: (files: FileList | null) => void;
}) {
  const inputId = `site-asset-${kind}`;
  const currentPreviewUrl = resolveConfiguredPath(currentPath);
  return (
    <section className="site-resource-picker">
      <div className="site-resource-current">
        <span className="site-resource-preview">
          {currentPreviewUrl ? <img alt="" src={currentPreviewUrl} /> : <ImageIcon aria-hidden="true" size={18} />}
        </span>
        <span>
          <strong>{label}<em>正在使用</em></strong>
          <small title={currentPath}>{currentPath}</small>
        </span>
        <label className="site-resource-upload" htmlFor={inputId}>
          <input
            accept={kind === "pwa_icon" ? "image/png,image/jpeg,image/webp" : "image/svg+xml,image/png,image/jpeg,image/webp"}
            id={inputId}
            onChange={(event) => {
              onUpload(event.target.files);
              event.currentTarget.value = "";
            }}
            type="file"
          />
          <UploadCloud aria-hidden="true" size={15} />
          {isUploading ? "上传中" : "上传"}
        </label>
      </div>
      <div className="site-resource-group">
        <span className="site-resource-group-title">内置资源</span>
        <div className="site-resource-options">
          {builtins.map((item) => (
            <button
              className={currentPath === item.path ? "active" : ""}
              key={item.path}
              onClick={() => onSelect(item.path)}
              type="button"
            >
              <img alt="" src={item.path} />
              <span>{item.label}</span>
              {currentPath === item.path ? <Check aria-hidden="true" size={13} /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="site-resource-group">
        <span className="site-resource-group-title">已上传</span>
        <div className="site-resource-options">
          {assets.map((asset) => {
            const configuredPath = toConfiguredApiAssetPath(asset.url);
            const isActive = currentPath === configuredPath;
            return (
              <span className={`site-resource-option uploaded${isActive ? " active" : ""}`} key={asset.id}>
                <button onClick={() => onSelect(configuredPath)} title={asset.originalName} type="button">
                  <img alt="" src={resolveSiteAssetUrl(asset)} />
                  <span><b>{asset.originalName}</b><small>{formatBytes(asset.sizeBytes)}</small></span>
                  {isActive ? <Check aria-hidden="true" size={13} /> : null}
                </button>
                <button
                  aria-label={`删除 ${asset.originalName}`}
                  disabled={busyAssetId === asset.id || isActive}
                  onClick={() => onDelete(asset)}
                  title={isActive ? "正在使用，保存其他资源后可删除" : "永久删除资源"}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </span>
            );
          })}
          {!assets.length ? <span className="site-resource-empty"><FolderOpen aria-hidden="true" size={14} />暂无上传资源</span> : null}
        </div>
      </div>
    </section>
  );
}

function BackgroundPicker({
  backgrounds,
  busyBackgroundId,
  currentPath,
  onDelete,
  onPreview,
  onUse,
}: {
  backgrounds: ManagedBackground[];
  busyBackgroundId: number | null;
  currentPath: string;
  onDelete: (background: ManagedBackground) => void;
  onPreview: (background: ManagedBackground) => void;
  onUse: (background: ManagedBackground) => void;
}) {
  return (
    <div className="site-background-picker">
      {backgrounds.map((background) => {
        const configuredPath = toConfiguredApiAssetPath(background.url);
        const isActive = background.isActive || currentPath === configuredPath;
        return (
          <article className={`site-background-choice uploaded${isActive ? " active live" : ""}`} key={background.id}>
            <span className="site-background-image" style={{ backgroundImage: `url("${resolveBackgroundUrl(background)}")` }} />
            <span className="site-background-copy">
              <strong title={background.originalName}>{background.originalName}</strong>
              <small>{formatFileSize(background.sizeBytes)} · {isActive ? "当前全站背景" : "已上传"}</small>
            </span>
            <span className="site-background-actions">
              <button aria-label={`预览 ${background.originalName}`} onClick={() => onPreview(background)} title="预览" type="button"><Eye aria-hidden="true" size={15} /></button>
              <button aria-label={`使用 ${background.originalName}`} className={isActive ? "active" : ""} disabled={busyBackgroundId === background.id || isActive} onClick={() => onUse(background)} title={isActive ? "正在使用" : "使用"} type="button"><Check aria-hidden="true" size={15} /></button>
              <button aria-label={`删除 ${background.originalName}`} className="danger" disabled={busyBackgroundId === background.id} onClick={() => onDelete(background)} title="删除" type="button"><Trash2 aria-hidden="true" size={15} /></button>
            </span>
          </article>
        );
      })}
      {!backgrounds.length ? <span className="site-background-empty"><FolderOpen aria-hidden="true" size={17} />还没有上传背景图片</span> : null}
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <span className="site-settings-summary-tile">
      <small>{label}</small>
      <strong title={value}>{value}</strong>
    </span>
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
              <label className="taxonomy-enabled" title={draft.enabled ? "已启用" : "未启用"}><input aria-label={`${taxonomy.name} 是否启用`} checked={draft.enabled} onChange={(event) => onDraftChange(taxonomy.id, { enabled: event.target.checked })} type="checkbox" /></label>
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

function resolveConfiguredPath(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/api/")) return resolveApiUrl(path.slice(4));
  return path.startsWith("/") ? path : `/${path}`;
}

function resourceDisplayName(
  path: string,
  builtins: Array<{ label: string; path: string }>,
  assets: SiteAsset[],
): string {
  const builtin = builtins.find((item) => item.path === path);
  if (builtin) return builtin.label;
  const uploaded = assets.find((asset) => toConfiguredApiAssetPath(asset.url) === path);
  return uploaded?.originalName ?? path;
}

function backgroundDisplayName(path: string, backgrounds: ManagedBackground[]): string {
  const builtin = BUILTIN_BACKGROUND_OPTIONS.find((item) => item.path === path);
  if (builtin) return builtin.label;
  const uploaded = backgrounds.find((background) => toConfiguredApiAssetPath(background.url) === path);
  return uploaded?.originalName ?? path;
}

function formatSelectedBackgroundFiles(files: File[]): string {
  if (!files.length) return "选择背景图片";
  if (files.length === 1) return files[0].name;
  return `已选择 ${files.length} 张`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function partitionSettingsPatch(patch: Partial<SiteSettingsInput>): {
  pending: Partial<SiteSettingsInput>;
  ready: Partial<SiteSettingsInput>;
} {
  const colorKeys = new Set<keyof SiteSettingsInput>([
    "defaultAccent",
    "defaultSurface",
    "defaultForeground",
    "defaultMuted",
    "defaultGlassTint",
  ]);
  const pending: Partial<SiteSettingsInput> = {};
  const ready: Partial<SiteSettingsInput> = {};

  for (const [rawKey, value] of Object.entries(patch)) {
    const key = rawKey as keyof SiteSettingsInput;
    const target = colorKeys.has(key) && !/^#[0-9a-fA-F]{6}$/.test(String(value)) ? pending : ready;
    Object.assign(target, { [key]: value });
  }

  return { pending, ready };
}
