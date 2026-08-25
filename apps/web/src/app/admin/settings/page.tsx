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
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { listRoles } from "@/lib/admin-api";
import { type AuthRole, type AuthUser, getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { growthLevelLabel } from "@/lib/system-labels";
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
  { value: "public", chinese: "公开", english: "Public" },
  { value: "authenticated", chinese: "登录可见", english: "Signed-in users" },
  { value: "role_restricted", chinese: "指定角色", english: "Selected roles" },
  { value: "private", chinese: "仅自己", english: "Only me" },
] as const;

const notificationRows = [
  ["notifyArticleLiked", "文章点赞", "Article likes"],
  ["notifyArticleFavorited", "文章收藏", "Article favorites"],
  ["notifyArticleCommented", "文章评论", "Article comments"],
  ["notifyCommentReplied", "评论回复", "Comment replies"],
  ["notifyAuthorSubscribed", "新增订阅者", "New subscribers"],
  ["notifySubscriptionPublished", "订阅作者发布", "Subscribed author publishes"],
  ["notifyFriendRequest", "好友申请", "Friend requests"],
  ["notifyCommentReport", "举报处理", "Report handling"],
  ["notifySystem", "系统消息", "System messages"],
] as const;

const templateRows = [
  ["templateArticleLiked", "点赞模板", "Like template"],
  ["templateArticleFavorited", "收藏模板", "Favorite template"],
  ["templateArticleCommented", "评论模板", "Comment template"],
  ["templateCommentReplied", "回复模板", "Reply template"],
  ["templateAuthorSubscribed", "订阅者模板", "Subscriber template"],
  ["templateSubscriptionPublished", "订阅发布模板", "Subscription publish template"],
  ["templateFriendRequest", "好友申请模板", "Friend request template"],
  ["templateCommentReportHandled", "举报结果模板", "Report result template"],
  ["templateCommentAuthorModerated", "评论处理模板", "Comment moderation template"],
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
type Phrase = (chinese: string, english: string) => string;

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
  { label: "城市灯火", path: "/images/hlovet-city-lights.jpg" },
] as const;

export default function SiteSettingsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
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
      router.replace(localizedPath("/login", locale));
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
          router.replace(localizedPath("/", locale));
          return;
        }
        if (isMounted) setError(loadError instanceof Error ? loadError.message : phrase("无法读取站点设置。", "Could not load site settings."));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSettings(token);
    return () => {
      isMounted = false;
    };
  }, [locale, phrase, router]);

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
    () => roles,
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
        if ("defaultBackgroundUrl" in patch) notifyBackgroundChange();
      })
      .catch((saveError) => {
        pendingSettingsPatchRef.current = { ...patch, ...pendingSettingsPatchRef.current };
        setError(saveError instanceof Error ? saveError.message : phrase("站点设置自动保存失败。", "Site settings could not be saved automatically."));
      })
      .finally(() => {
        settingsSaveCountRef.current = Math.max(0, settingsSaveCountRef.current - 1);
        if (settingsSaveCountRef.current === 0) setIsSaving(false);
      });
  }

  async function handleResetSettings() {
    if (!accessToken || !window.confirm(phrase("恢复默认站点设置吗？已上传的资源、背景图片、文章分类和标签不会删除。", "Restore default site settings? Uploaded assets, backgrounds, article categories, and tags will not be deleted."))) return;
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
      setNotice(phrase("站点设置已恢复默认。", "Site settings were restored to defaults."));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : phrase("恢复默认设置失败。", "Could not restore default settings."));
    } finally {
      settingsSaveCountRef.current = 0;
      setIsSaving(false);
    }
  }

  async function handleCreateTaxonomy(kind: ArticleTaxonomyKind) {
    if (!accessToken) return;
    const payload = { ...newTaxonomy, kind, name: newTaxonomy.name.trim() };
    if (!payload.name) {
      setError(phrase("分类或标签名称不能为空。", "A category or tag name is required."));
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
      setNotice(kind === "category" ? phrase("分类已新增。", "Category created.") : phrase("标签已新增。", "Tag created."));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : phrase("新增失败。", "Could not create it."));
    } finally {
      setBusyTaxonomyId(null);
    }
  }

  async function handleUpdateTaxonomy(taxonomy: ArticleTaxonomy) {
    if (!accessToken) return;
    const payload = taxonomyDrafts[taxonomy.id];
    if (!payload?.name.trim()) {
      setError(phrase("分类或标签名称不能为空。", "A category or tag name is required."));
      return;
    }
    setBusyTaxonomyId(taxonomy.id);
    setError("");
    setNotice("");
    try {
      await updateArticleTaxonomy(accessToken, taxonomy.id, { ...payload, name: payload.name.trim() });
      const refreshed = await getAdminSiteSettings(accessToken);
      applySettings(refreshed);
      setNotice(phrase("分类或标签已更新。", "Category or tag updated."));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : phrase("更新失败。", "Could not update it."));
    } finally {
      setBusyTaxonomyId(null);
    }
  }

  async function handleDeleteTaxonomy(taxonomy: ArticleTaxonomy) {
    if (!accessToken || !window.confirm(phrase(`确定删除“${taxonomy.name}”吗？已有文章中的文字分类或标签不会被删除。`, `Delete “${taxonomy.name}”? Existing article category or tag text will not be removed.`))) return;
    setBusyTaxonomyId(taxonomy.id);
    setError("");
    setNotice("");
    try {
      await deleteArticleTaxonomy(accessToken, taxonomy.id);
      const refreshed = await getAdminSiteSettings(accessToken);
      applySettings(refreshed);
      setNotice(phrase("分类或标签已删除。", "Category or tag deleted."));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("删除失败。", "Could not delete it."));
    } finally {
      setBusyTaxonomyId(null);
    }
  }

  async function handleAssetUpload(kind: SiteAssetKind, files: FileList | null) {
    if (!accessToken || !files?.length) return;
    const file = files[0];
    if (file.size > MAX_SITE_ASSET_SIZE) {
      setError(phrase("单个站点资源不能超过 5 MB。", "Each site asset must be at most 5 MB."));
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
      setNotice(kind === "logo" ? phrase("Logo 已上传并应用。", "Logo uploaded and applied.") : phrase("PWA 图标已上传并应用。", "PWA icon uploaded and applied."));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : phrase("站点资源上传失败。", "Could not upload the site asset."));
    } finally {
      setAssetUploadKind(null);
    }
  }

  async function handleDeleteAsset(asset: SiteAsset) {
    const configuredPath = toConfiguredApiAssetPath(asset.url);
    const activePath = asset.kind === "logo" ? draft?.logoPath : draft?.pwaIconPath;
    if (activePath === configuredPath) {
      setError(phrase("该资源正在使用，请先选择其他资源后再删除。", "This asset is in use. Choose another one before deleting it."));
      return;
    }
    if (!accessToken || !window.confirm(phrase(`确定永久删除“${asset.originalName}”吗？`, `Permanently delete “${asset.originalName}”?`))) return;
    setBusyAssetId(asset.id);
    setError("");
    setNotice("");
    try {
      await deleteSiteAsset(accessToken, asset.id);
      setSiteAssets((current) => current.filter((item) => item.id !== asset.id));
      setNotice(phrase("站点资源已删除。", "Site asset deleted."));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("站点资源删除失败。", "Could not delete the site asset."));
    } finally {
      setBusyAssetId(null);
    }
  }

  async function handleBackgroundUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !backgroundUploadFiles.length) {
      setError(phrase("请选择背景图片。", "Choose background images."));
      return;
    }
    if (backgroundUploadFiles.length > MAX_BACKGROUND_FILES) {
      setError(phrase(`一次最多上传 ${MAX_BACKGROUND_FILES} 张背景图。`, `You can upload at most ${MAX_BACKGROUND_FILES} background images at once.`));
      return;
    }
    const oversized = backgroundUploadFiles.find((file) => file.size > MAX_BACKGROUND_FILE_SIZE);
    if (oversized) {
      setError(phrase(`${oversized.name} 超过 30 MB。`, `${oversized.name} exceeds 30 MB.`));
      return;
    }
    setIsBackgroundUploading(true);
    setError("");
    setNotice("");
    try {
      const uploaded = await uploadBackgrounds(accessToken, backgroundUploadFiles);
      setBackgrounds((current) => [...uploaded, ...current]);
      setBackgroundUploadFiles([]);
      setNotice(phrase(`${uploaded.length} 张背景图已上传。`, `${uploaded.length} background image(s) uploaded.`));
      const input = document.getElementById("site-background-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : phrase("背景图片上传失败。", "Could not upload the background images."));
    } finally {
      setIsBackgroundUploading(false);
    }
  }

  async function handleDeleteBackground(background: ManagedBackground) {
    if (!accessToken) return;
    const confirmed = window.confirm(
      background.isActive
        ? phrase("删除当前全站背景后将回到设置页选择的内置默认背景，确定删除吗？", "Deleting the active background returns the site to its configured built-in background. Continue?")
        : phrase(`确定从磁盘中永久删除 ${background.originalName} 吗？`, `Permanently delete ${background.originalName} from disk?`),
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
      setNotice(phrase("背景图片及磁盘文件已删除。", "Background image and its file were deleted."));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("背景图片删除失败。", "Could not delete the background image."));
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
      setNotice(phrase("全站背景已切换。", "Site background updated."));
    } catch (useError) {
      setError(useError instanceof Error ? useError.message : phrase("背景切换失败。", "Could not update the background."));
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
        <h1>{phrase("站点设置", "Site settings")}</h1>
        <div className="status-row"><span className="status">{phrase("正在读取设置", "Loading settings")}</span></div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无法进入站点设置", "Could not open site settings")}</h1>
        <p>{error || phrase("请重新登录后访问。", "Sign in again to continue.")}</p>
        <Link className="text-action primary" href={localizedPath("/login", locale)}>{phrase("返回登录", "Back to sign in")}</Link>
      </section>
    );
  }

  if (!currentUser.isSuperAdmin || !draft) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无权访问", "Access denied")}</h1>
        <p>{phrase("该页面仅超级管理员可以查看和修改。", "Only super administrators can view and edit this page.")}</p>
        <Link className="text-action primary" href={localizedPath("/dashboard", locale)}>{phrase("返回工作台", "Back to workspace")}</Link>
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
            <h1>{phrase("站点设置中心", "Site settings")}</h1>
          </div>
          <div className="site-settings-head-actions">
            <span className={isSaving ? "saving" : ""}>{isSaving ? phrase("正在自动保存", "Saving automatically") : phrase("修改后自动保存", "Changes save automatically")}</span>
            <button className="button site-settings-save" disabled={isSaving} onClick={() => void handleResetSettings()} type="button">
              {isSaving ? <Settings2 aria-hidden="true" className="spin" size={16} /> : <RotateCcw aria-hidden="true" size={16} />}
              {phrase("恢复默认", "Restore defaults")}
            </button>
          </div>
        </div>

        <div className="site-settings-grid">
          <section className="site-settings-card">
            <PanelTitle icon={Globe2} label={phrase("站点基础", "Site basics")} />
            <div className="site-settings-field-grid">
              <label><span>{phrase("网站名称", "Site name")}</span><input maxLength={80} onChange={(event) => updateDraft({ siteName: event.target.value })} value={draft.siteName} /></label>
              <label><span>{phrase("浏览器标题", "Browser title")}</span><input maxLength={120} onChange={(event) => updateDraft({ browserTitle: event.target.value })} value={draft.browserTitle} /></label>
              <label><span>{phrase("开放注册", "Open registration")}</span><GlassSelect ariaLabel={phrase("开放注册", "Open registration")} onChange={(value) => updateDraft({ registrationOpen: value === "true" }, true)} options={[{ value: "true", label: phrase("开放", "Open") }, { value: "false", label: phrase("关闭", "Closed") }]} value={String(draft.registrationOpen)} /></label>
              <label><span>{phrase("默认角色", "Default role")}</span><GlassSelect ariaLabel={phrase("默认角色", "Default role")} onChange={(value) => updateDraft({ defaultRoleCode: value }, true)} options={roleOptions.map((role) => ({ value: role.code, label: growthLevelLabel(role.code, locale, role.name) }))} value={draft.defaultRoleCode} /></label>
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
                phrase={phrase}
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
                label={phrase("PWA 图标", "PWA icon")}
                phrase={phrase}
                onDelete={(asset) => void handleDeleteAsset(asset)}
                onSelect={(path) => updateDraft({ pwaIconPath: path }, true)}
                onUpload={(files) => void handleAssetUpload("pwa_icon", files)}
              />
            </div>
          </section>

          <section className="site-settings-card">
            <PanelTitle icon={Settings2} label={phrase("默认主题", "Default theme")} />
            <div className="site-settings-field-grid">
              <label><span>{phrase("主题", "Theme")}</span><GlassSelect ariaLabel={phrase("主题", "Theme")} onChange={(value) => updateDraft({ defaultThemeId: value as ThemeId }, true)} options={[...portalThemes.map((theme) => ({ value: theme.id, label: theme.name })), { value: "custom", label: phrase("自定义", "Custom") }]} value={draft.defaultThemeId} /></label>
              <ColorField label={phrase("强调色", "Accent color")} value={draft.defaultAccent} onChange={(value) => updateDraft({ defaultAccent: value })} />
              <ColorField label={phrase("卡片颜色", "Card color")} value={draft.defaultSurface} onChange={(value) => updateDraft({ defaultSurface: value })} />
              <ColorField label={phrase("文字颜色", "Text color")} value={draft.defaultForeground} onChange={(value) => updateDraft({ defaultForeground: value })} />
              <ColorField label={phrase("弱文字色", "Muted text color")} value={draft.defaultMuted} onChange={(value) => updateDraft({ defaultMuted: value })} />
              <ColorField label={phrase("磨砂颜色", "Glass tint")} value={draft.defaultGlassTint} onChange={(value) => updateDraft({ defaultGlassTint: value })} />
              <RangeField label={phrase("卡片透明度", "Card opacity")} max={76} min={38} value={draft.defaultCardAlpha} onChange={(value) => updateDraft({ defaultCardAlpha: value })} />
              <RangeField label={phrase("磨砂程度", "Glass blur")} max={36} min={0} value={draft.defaultGlassBlur} onChange={(value) => updateDraft({ defaultGlassBlur: value })} />
              <RangeField label={phrase("磨砂遮罩", "Glass overlay")} max={100} min={0} value={draft.defaultGlassTintAlpha} onChange={(value) => updateDraft({ defaultGlassTintAlpha: value })} />
            </div>
          </section>

          <section className="site-settings-card">
            <PanelTitle icon={Package} label={phrase("安装包设置", "Package settings")} />
            <div className="site-settings-field-grid">
              <label><span>{phrase("安装页", "Install page")}</span><GlassSelect ariaLabel={phrase("安装页", "Install page")} onChange={(value) => updateDraft({ installPageEnabled: value === "true" }, true)} options={[{ value: "true", label: phrase("启用", "Enabled") }, { value: "false", label: phrase("关闭", "Disabled") }]} value={String(draft.installPageEnabled)} /></label>
              <label><span>{phrase("保留历史版本", "Keep version history")}</span><GlassSelect ariaLabel={phrase("保留历史版本", "Keep version history")} onChange={(value) => updateDraft({ apkHistoryEnabled: value === "true" }, true)} options={[{ value: "true", label: phrase("保留", "Keep") }, { value: "false", label: phrase("只保留最新版", "Keep latest only") }]} value={String(draft.apkHistoryEnabled)} /></label>
              <label><span>{phrase("自动清理旧版", "Clean up older versions")}</span><GlassSelect ariaLabel={phrase("自动清理旧版", "Clean up older versions")} onChange={(value) => updateDraft({ apkAutoCleanupEnabled: value === "true" }, true)} options={[{ value: "false", label: phrase("手动清理", "Manual cleanup") }, { value: "true", label: phrase("自动清理", "Automatic cleanup") }]} value={String(draft.apkAutoCleanupEnabled)} /></label>
              <label><span>{phrase("最多保留", "Keep at most")}</span><input max={20} min={1} onChange={(event) => updateDraft({ apkRetentionCount: Number(event.target.value) })} type="number" value={draft.apkRetentionCount} /></label>
            </div>
            <Link className="text-action primary site-settings-inline-link" href={localizedPath("/admin/android", locale)}>{phrase("进入安装包管理", "Open package management")}</Link>
          </section>

          <section className="site-settings-card site-settings-summary-card">
            <PanelTitle icon={Sparkles} label={phrase("资源状态", "Asset status")} />
            <div className="site-settings-summary-grid">
              <SummaryTile label="Logo" value={resourceDisplayName(draft.logoPath, [...BUILTIN_LOGO_OPTIONS], logoAssets, phrase)} />
              <SummaryTile label={phrase("PWA 图标", "PWA icon")} value={resourceDisplayName(draft.pwaIconPath, [...BUILTIN_PWA_ICON_OPTIONS], pwaIconAssets, phrase)} />
              <SummaryTile label={phrase("当前背景", "Active background")} value={backgrounds.find((background) => background.isActive)?.originalName ?? phrase("未设置", "Not set")} />
              <SummaryTile label={phrase("背景图库", "Background library")} value={phrase(`${backgrounds.length} 张`, `${backgrounds.length} images`)} />
            </div>
            <p className="site-settings-hint">
              {phrase("当前背景就是所有用户实际看到的全站背景；点击背景卡片上的“使用”后会立即同步到当前页面，其他页面刷新后生效。", "The active background is the site-wide background all users see. Choosing Use on a background card updates this page immediately and takes effect elsewhere after refresh.")}
            </p>
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={ImageIcon} label={phrase("背景管理", "Background management")} />
            <div className="site-background-tools">
              <div>
                <strong>{phrase("全站背景", "Site-wide background")}</strong>
                <span>{phrase("上传自己的背景图片，每次最多 5 张；系统会自动压缩为 WebP，仍可预览、启用或永久删除。", "Upload up to 5 background images at once. They are compressed to WebP and can still be previewed, activated, or permanently deleted.")}</span>
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
                  <span>{formatSelectedBackgroundFiles(backgroundUploadFiles, phrase)}</span>
                </label>
                <button className="text-action primary" disabled={isBackgroundUploading || !backgroundUploadFiles.length} type="submit">
                  {isBackgroundUploading ? phrase("上传中", "Uploading") : phrase("上传", "Upload")}
                </button>
              </form>
            </div>
            <BackgroundPicker
              backgrounds={backgrounds}
              busyBackgroundId={busyBackgroundId}
              phrase={phrase}
              onDelete={(background) => void handleDeleteBackground(background)}
              onPreview={setPreviewBackground}
              onUse={(background) => void handleUseBackground(background)}
            />
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={FileText} label={phrase("内容发布设置", "Publishing settings")} />
            <div className="site-settings-field-grid compact">
              <label><span>{phrase("默认阅读权限", "Default reading permission")}</span><GlassSelect ariaLabel={phrase("默认阅读权限", "Default reading permission")} onChange={(value) => updateDraft({ defaultArticleVisibility: value as SiteSettingsInput["defaultArticleVisibility"] }, true)} options={VISIBILITY_OPTIONS.map((item) => ({ value: item.value, label: phrase(item.chinese, item.english) }))} value={draft.defaultArticleVisibility} /></label>
              <label><span>{phrase("图片上限 MB", "Image limit (MB)")}</span><input max={30} min={1} onChange={(event) => updateDraft({ articleImageMaxSizeMb: Number(event.target.value) })} type="number" value={draft.articleImageMaxSizeMb} /></label>
              <label><span>{phrase("评论", "Comments")}</span><GlassSelect ariaLabel={phrase("评论", "Comments")} onChange={(value) => updateDraft({ commentsEnabled: value === "true" }, true)} options={[{ value: "true", label: phrase("开启", "Enabled") }, { value: "false", label: phrase("关闭", "Disabled") }]} value={String(draft.commentsEnabled)} /></label>
              <label><span>{phrase("举报", "Reports")}</span><GlassSelect ariaLabel={phrase("举报", "Reports")} onChange={(value) => updateDraft({ reportsEnabled: value === "true" }, true)} options={[{ value: "true", label: phrase("开启", "Enabled") }, { value: "false", label: phrase("关闭", "Disabled") }]} value={String(draft.reportsEnabled)} /></label>
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
                title={phrase("文章分类", "Article categories")}
                phrase={phrase}
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
                title={phrase("文章标签", "Article tags")}
                phrase={phrase}
              />
            </div>
          </section>

          <section className="site-settings-card wide">
            <PanelTitle icon={Bell} label={phrase("通知设置", "Notification settings")} />
            <div className="notification-toggle-grid">
              {notificationRows.map(([key, chinese, english]) => (
                <label key={key}>
                  <input
                    checked={Boolean(draft[key])}
                    onChange={(event) => updateDraft({ [key]: event.target.checked } as Partial<SiteSettingsInput>, true)}
                    type="checkbox"
                  />
                  <span>{phrase(chinese, english)}</span>
                </label>
              ))}
            </div>
            <div className="notification-template-grid">
              {templateRows.map(([key, chinese, english]) => (
                <label key={key}>
                  <span>{phrase(chinese, english)}</span>
                  <input
                    maxLength={240}
                    onChange={(event) => updateDraft({ [key]: event.target.value } as Partial<SiteSettingsInput>)}
                    value={String(draft[key])}
                  />
                </label>
              ))}
            </div>
            <p className="site-settings-hint">{phrase("模板支持变量：", "Templates support: ")}{"{actor}"}、{"{author}"}、{"{article}"}、{"{comment}"}、{"{result}"}、{"{count}"}。</p>
          </section>
        </div>
      </div>
      {previewBackground ? <div className="site-background-preview-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setPreviewBackground(null); }} role="presentation">
        <div aria-modal="true" className="site-background-preview-dialog" role="dialog">
          <button aria-label={phrase("关闭背景预览", "Close background preview")} onClick={() => setPreviewBackground(null)} type="button"><X aria-hidden="true" size={20} /></button>
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
  phrase,
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
  phrase: Phrase;
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
          <strong>{label}<em>{phrase("正在使用", "In use")}</em></strong>
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
          {isUploading ? phrase("上传中", "Uploading") : phrase("上传", "Upload")}
        </label>
      </div>
      <div className="site-resource-group">
        <span className="site-resource-group-title">{phrase("内置资源", "Built-in assets")}</span>
        <div className="site-resource-options">
          {builtins.map((item) => (
            <button
              className={currentPath === item.path ? "active" : ""}
              key={item.path}
              onClick={() => onSelect(item.path)}
              type="button"
            >
              <img alt="" src={item.path} />
              <span>{resourceLabel(item.label, phrase)}</span>
              {currentPath === item.path ? <Check aria-hidden="true" size={13} /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="site-resource-group">
        <span className="site-resource-group-title">{phrase("已上传", "Uploaded")}</span>
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
                  aria-label={phrase(`删除 ${asset.originalName}`, `Delete ${asset.originalName}`)}
                  disabled={busyAssetId === asset.id || isActive}
                  onClick={() => onDelete(asset)}
                  title={isActive ? phrase("正在使用，保存其他资源后可删除", "In use. Save another asset before deleting it.") : phrase("永久删除资源", "Permanently delete asset")}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </span>
            );
          })}
          {!assets.length ? <span className="site-resource-empty"><FolderOpen aria-hidden="true" size={14} />{phrase("暂无上传资源", "No uploaded assets")}</span> : null}
        </div>
      </div>
    </section>
  );
}

function BackgroundPicker({
  backgrounds,
  busyBackgroundId,
  onDelete,
  onPreview,
  onUse,
  phrase,
}: {
  backgrounds: ManagedBackground[];
  busyBackgroundId: number | null;
  onDelete: (background: ManagedBackground) => void;
  onPreview: (background: ManagedBackground) => void;
  onUse: (background: ManagedBackground) => void;
  phrase: Phrase;
}) {
  return (
    <div className="site-background-picker">
      {backgrounds.map((background) => {
        const isActive = background.isActive;
        return (
          <article className={`site-background-choice uploaded${isActive ? " active live" : ""}`} key={background.id}>
            <span className="site-background-image" style={{ backgroundImage: `url("${resolveBackgroundUrl(background)}")` }} />
            <span className="site-background-copy">
              <strong title={background.originalName}>{background.originalName}</strong>
              <small>{formatFileSize(background.sizeBytes)} · {isActive ? phrase("当前全站背景", "Active site background") : phrase("已上传", "Uploaded")}</small>
            </span>
            <span className="site-background-actions">
              <button aria-label={phrase(`预览 ${background.originalName}`, `Preview ${background.originalName}`)} onClick={() => onPreview(background)} title={phrase("预览", "Preview")} type="button"><Eye aria-hidden="true" size={15} /></button>
              <button aria-label={phrase(`使用 ${background.originalName}`, `Use ${background.originalName}`)} className={isActive ? "active" : ""} disabled={busyBackgroundId === background.id || isActive} onClick={() => onUse(background)} title={isActive ? phrase("正在使用", "In use") : phrase("使用", "Use")} type="button"><Check aria-hidden="true" size={15} /></button>
              <button aria-label={phrase(`删除 ${background.originalName}`, `Delete ${background.originalName}`)} className="danger" disabled={busyBackgroundId === background.id} onClick={() => onDelete(background)} title={phrase("删除", "Delete")} type="button"><Trash2 aria-hidden="true" size={15} /></button>
            </span>
          </article>
        );
      })}
      {!backgrounds.length ? <span className="site-background-empty"><FolderOpen aria-hidden="true" size={17} />{phrase("还没有上传背景图片", "No background images uploaded")}</span> : null}
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
  phrase,
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
  phrase: Phrase;
}) {
  return (
    <div className="taxonomy-panel">
      <div className="taxonomy-panel-head">
        <strong>{title}</strong>
        <span>{phrase(`${items.length} 项`, `${items.length} items`)}</span>
      </div>
      <div className="taxonomy-create-row">
        <input maxLength={80} onChange={(event) => onNewDraftChange({ name: event.target.value })} placeholder={kind === "category" ? phrase("新增分类", "New category") : phrase("新增标签", "New tag")} value={newDraft.name} />
        <input aria-label={phrase("颜色", "Color")} onChange={(event) => onNewDraftChange({ color: event.target.value })} type="color" value={newDraft.color} />
        <button className="text-action primary" disabled={busyId === 0} onClick={onCreate} type="button"><Plus aria-hidden="true" size={15} />{phrase("新增", "Add")}</button>
      </div>
      <div className="taxonomy-list">
        {items.map((taxonomy) => {
          const draft = drafts[taxonomy.id] ?? toTaxonomyInput(taxonomy);
          const isBusy = busyId === taxonomy.id;
          return (
            <article className="taxonomy-row" key={taxonomy.id}>
              <span className="taxonomy-color-dot" style={{ background: draft.color }} />
              <input maxLength={80} onChange={(event) => onDraftChange(taxonomy.id, { name: event.target.value })} value={draft.name} />
              <input aria-label={phrase(`${taxonomy.name} 颜色`, `${taxonomy.name} color`)} onChange={(event) => onDraftChange(taxonomy.id, { color: event.target.value })} type="color" value={draft.color} />
              <input aria-label={phrase(`${taxonomy.name} 排序`, `${taxonomy.name} order`)} min={0} onChange={(event) => onDraftChange(taxonomy.id, { sortOrder: Number(event.target.value) })} type="number" value={draft.sortOrder} />
              <label className="taxonomy-enabled" title={draft.enabled ? phrase("已启用", "Enabled") : phrase("未启用", "Disabled")}><input aria-label={phrase(`${taxonomy.name} 是否启用`, `${taxonomy.name} enabled`)} checked={draft.enabled} onChange={(event) => onDraftChange(taxonomy.id, { enabled: event.target.checked })} type="checkbox" /></label>
              <div className="taxonomy-actions">
                <button aria-label={phrase(`保存 ${taxonomy.name}`, `Save ${taxonomy.name}`)} disabled={isBusy} onClick={() => onUpdate(taxonomy)} title={phrase("保存", "Save")} type="button"><Check aria-hidden="true" size={15} /></button>
                <button aria-label={phrase(`删除 ${taxonomy.name}`, `Delete ${taxonomy.name}`)} disabled={isBusy} onClick={() => onDelete(taxonomy)} title={phrase("删除", "Delete")} type="button"><Trash2 aria-hidden="true" size={15} /></button>
              </div>
            </article>
          );
        })}
        {!items.length ? <p className="taxonomy-empty">{phrase("还没有配置内容。", "Nothing is configured yet.")}</p> : null}
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
  phrase: Phrase,
): string {
  const builtin = builtins.find((item) => item.path === path);
  if (builtin) return resourceLabel(builtin.label, phrase);
  const uploaded = assets.find((asset) => toConfiguredApiAssetPath(asset.url) === path);
  return uploaded?.originalName ?? path;
}

function formatSelectedBackgroundFiles(files: File[], phrase: Phrase): string {
  if (!files.length) return phrase("选择背景图片", "Choose background images");
  if (files.length === 1) return files[0].name;
  return phrase(`已选择 ${files.length} 张`, `${files.length} selected`);
}

function resourceLabel(label: string, phrase: Phrase): string {
  const labels: Record<string, [string, string]> = {
    "默认 SVG": ["默认 SVG", "Default SVG"],
    "HLOVET Logo": ["HLOVET Logo", "HLOVET Logo"],
    "页签图标": ["页签图标", "Tab icon"],
    "PNG Logo": ["PNG Logo", "PNG Logo"],
    "Logo 图标": ["Logo 图标", "Logo icon"],
    "192 图标": ["192 图标", "192 icon"],
    "512 图标": ["512 图标", "512 icon"],
    "Apple 图标": ["Apple 图标", "Apple icon"],
  };
  const translation = labels[label];
  return translation ? phrase(...translation) : label;
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
