"use client";

import { Check, ChevronDown, Cloud, CloudOff, Eye, History, ImagePlus, RefreshCw, RotateCcw, Save, Send, Tags, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleBody, displayArticleTaxonomy, formatArticleDate } from "@/components/article-ui";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import {
  Article,
  ArticleInput,
  ArticleVersion,
  ArticleVersionSummary,
  autosaveArticle,
  createArticle,
  deleteArticle,
  getArticleVersion,
  getMyArticle,
  listArticleVersions,
  publishArticle,
  restoreArticleVersion,
  unpublishArticle,
  updateArticle,
  uploadArticleImages,
} from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getPublicSiteSettings, type SiteSettings } from "@/lib/site-settings-api";
import { localizedPath } from "@/lib/i18n";

const MAX_ARTICLE_IMAGES = 20;
const MAX_SELECTED_TAGS = 6;
const PENDING_IMAGE_PATH_PREFIX = "/__pending_article_image__/";
const ARTICLE_AUTOSAVE_DELAY_MS = 1800;
const ARTICLE_LOCAL_DRAFT_PREFIX = "lingxi:article-draft";
const ARTICLE_CATEGORY_OPTIONS = ["随笔", "技术", "服务器", "工具", "资源", "教程", "生活", "公告"];
const ARTICLE_TAG_OPTIONS = [
  "AI",
  "开发",
  "前端",
  "后端",
  "数据库",
  "运维",
  "服务器",
  "网络",
  "工具",
  "资源",
  "教程",
  "经验",
  "随笔",
  "生活",
  "公告",
];

interface PendingArticleImage {
  id: string;
  file: File;
  marker: string;
  previewUrl: string;
}

interface LocalArticleDraft {
  draft: ArticleInput;
  savedAt: string;
  pendingImageNames: string[];
}

type AutosaveState = "idle" | "waiting" | "saving" | "saved" | "offline";

const emptyDraft: ArticleInput = {
  title: "",
  summary: "",
  content: "",
  category: "随笔",
  tags: "",
  titleColor: "",
  visibility: "public",
  roleCodes: [],
};

export function ArticleEditor({ articleId }: { articleId?: number }) {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [draft, setDraft] = useState<ArticleInput>(emptyDraft);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingArticleImage[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(articleId));
  const [isSaving, setIsSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [lastAutosavedAt, setLastAutosavedAt] = useState<Date | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<LocalArticleDraft | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ArticleVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ArticleVersion | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const categoryPickerRef = useRef<HTMLDivElement | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);
  const pendingImagesRef = useRef<PendingArticleImage[]>([]);
  const articleRef = useRef<Article | null>(null);
  const initializedRef = useRef(false);
  const lastSavedSignatureRef = useRef("");
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveRequestRef = useRef<Promise<void> | null>(null);
  const [isCategoryPickerOpen, setIsCategoryPickerOpen] = useState(false);
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const articleStatusLabel = (status: Article["status"]) => status === "draft" ? phrase("草稿", "Draft") : status === "published" ? phrase("已发布", "Published") : status === "unpublished" ? phrase("已下架", "Unpublished") : status === "blocked" ? phrase("受限", "Restricted") : phrase("已删除", "Deleted");
  const visibilityLabel = (visibility: ArticleInput["visibility"]) => visibility === "public" ? phrase("所有人可见", "Public") : visibility === "authenticated" ? phrase("仅登录用户", "Signed-in users") : visibility === "role_restricted" ? phrase("指定角色", "Specific roles") : phrase("仅自己", "Only me");
  const versionSourceLabel = (source: ArticleVersionSummary["source"]) => source === "autosave" ? phrase("自动保存", "Autosave") : source === "manual" ? phrase("手动保存", "Manual save") : source === "publish" ? phrase("发布", "Publish") : phrase("恢复版本", "Restore version");
  const versionFieldLabel = (field: string) => ({ title: phrase("标题", "Title"), summary: phrase("摘要", "Summary"), content: phrase("正文", "Content"), category: phrase("分类", "Category"), tags: phrase("标签", "Tags"), titleColor: phrase("标题颜色", "Title color"), visibility: phrase("阅读权限", "Visibility"), status: phrase("状态", "Status"), roleCodes: phrase("可见角色", "Visible roles") }[field] ?? field);
  const visibilityOptions = (["public", "authenticated", "role_restricted", "private"] as const).map((value) => ({ label: visibilityLabel(value), value }));
  const selectedTags = useMemo(() => parseArticleTags(draft.tags), [draft.tags]);
  const configuredCategoryOptions = useMemo(
    () => siteSettings?.taxonomies?.categories?.filter((item) => item.enabled).map((item) => item.name) ?? ARTICLE_CATEGORY_OPTIONS,
    [siteSettings],
  );
  const configuredTagOptions = useMemo(
    () => siteSettings?.taxonomies?.tags?.filter((item) => item.enabled).map((item) => item.name) ?? ARTICLE_TAG_OPTIONS,
    [siteSettings],
  );
  const imageMaxSizeMb = siteSettings?.articleImageMaxSizeMb ?? 10;
  const categoryOptions = useMemo(
    () => draft.category && !configuredCategoryOptions.includes(draft.category)
      ? [draft.category, ...configuredCategoryOptions]
      : configuredCategoryOptions,
    [configuredCategoryOptions, draft.category],
  );
  const tagOptions = useMemo(
    () => Array.from(new Set([...configuredTagOptions, ...selectedTags])),
    [configuredTagOptions, selectedTags],
  );
  const pendingImageUrls = useMemo(
    () => Object.fromEntries(pendingImages.map((image) => [image.marker, image.previewUrl])),
    [pendingImages],
  );

  const localDraftKey = useMemo(
    () => user ? `${ARTICLE_LOCAL_DRAFT_PREFIX}:${user.id}:${article?.id ?? articleId ?? "new"}` : "",
    [article?.id, articleId, user],
  );

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => {
    articleRef.current = article;
  }, [article]);

  useEffect(() => () => {
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    pendingImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  useEffect(() => {
    if (!isCategoryPickerOpen && !isTagPickerOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!categoryPickerRef.current?.contains(event.target as Node)) setIsCategoryPickerOpen(false);
      if (!tagPickerRef.current?.contains(event.target as Node)) setIsTagPickerOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCategoryPickerOpen(false);
        setIsTagPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCategoryPickerOpen, isTagPickerOpen]);

  useEffect(() => {
    if (!isPreviewOpen && !isVersionsOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsPreviewOpen(false);
      setIsVersionsOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isPreviewOpen, isVersionsOpen]);

  function applyArticle(loaded: Article) {
    if (loaded.status === "deleted") {
      router.replace(localizedPath("/articles/mine?status=deleted", locale));
      return;
    }
    const nextDraft = articleToDraft(loaded);
    articleRef.current = loaded;
    setArticle(loaded);
    setDraft(nextDraft);
    lastSavedSignatureRef.current = articleDraftSignature(nextDraft);
    setLastAutosavedAt(new Date(loaded.updatedAt));
  }

  function readRecoveryDraft(userId: number, loadedArticle: Article | null): LocalArticleDraft | null {
    const key = `${ARTICLE_LOCAL_DRAFT_PREFIX}:${userId}:${loadedArticle?.id ?? articleId ?? "new"}`;
    const stored = readLocalArticleDraft(key);
    if (!stored) return null;
    const serverDraft = loadedArticle ? articleToDraft(loadedArticle) : null;
    const differs = !serverDraft || articleDraftSignature(stored.draft) !== articleDraftSignature(serverDraft);
    const isNewer = !loadedArticle || new Date(stored.savedAt).getTime() > new Date(loadedArticle.updatedAt).getTime();
    return (differs && isNewer) || stored.pendingImageNames.length ? stored : null;
  }

  function articleToDraft(loaded: Article): ArticleInput {
    return {
      title: loaded.title,
      summary: "",
      content: loaded.content,
      category: loaded.category || "随笔",
      tags: loaded.tags.join(", "),
      titleColor: loaded.titleColor,
      visibility: loaded.visibility,
      roleCodes: loaded.allowedRoles.map((role) => role.code),
    };
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath(`/login?from=${encodeURIComponent(articleId ? `/articles/edit/${articleId}` : "/articles/write")}`, locale));
      return;
    }
    Promise.all([
      getMe(token),
      articleId ? getMyArticle(token, articleId) : Promise.resolve(null),
      getPublicSiteSettings().catch(() => null),
    ] as const)
      .then((results) => {
        const loadedUser = results[0] as AuthUser;
        setUser(loadedUser);
        const loadedArticle = results[1] as Article | null;
        const loadedSettings = results[2] as SiteSettings | null;
        if (loadedSettings) {
          setSiteSettings(loadedSettings);
        }
        if (loadedArticle) {
          applyArticle(loadedArticle);
          setRecoveryDraft(readRecoveryDraft(loadedUser.id, loadedArticle));
          initializedRef.current = true;
          return;
        }
        let initialDraft = emptyDraft;
        if (loadedSettings) {
          initialDraft = {
            ...emptyDraft,
            category: loadedSettings.taxonomies?.categories?.[0]?.name ?? emptyDraft.category,
            visibility: loadedSettings.defaultArticleVisibility ?? emptyDraft.visibility,
          };
        }
        setDraft(initialDraft);
        lastSavedSignatureRef.current = articleDraftSignature(initialDraft);
        setRecoveryDraft(readRecoveryDraft(loadedUser.id, null));
        initializedRef.current = true;
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("无法读取文章。", "Could not load the article."));
      })
      .finally(() => setIsLoading(false));
    // The editor identity is fixed for the route lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, router]);

  useEffect(() => {
    if (!initializedRef.current || !user || isLoading || isSaving || !localDraftKey) return;
    const serverDraft = draftWithoutPendingImages(draft, pendingImages);
    const signature = articleDraftSignature(serverDraft);
    if (signature === lastSavedSignatureRef.current) {
      if (pendingImages.length) {
        writeLocalArticleDraft(localDraftKey, {
          draft: serverDraft,
          savedAt: new Date().toISOString(),
          pendingImageNames: pendingImages.map((image) => image.file.name),
        });
      } else {
        removeLocalArticleDraft(localDraftKey);
      }
      return;
    }
    writeLocalArticleDraft(localDraftKey, {
      draft: serverDraft,
      savedAt: new Date().toISOString(),
      pendingImageNames: pendingImages.map((image) => image.file.name),
    });
    setAutosaveState("waiting");
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void runAutosave(serverDraft, signature, localDraftKey);
    }, ARTICLE_AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    // runAutosave reads identity and pending-file state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, pendingImages, user, isLoading, isSaving, localDraftKey]);

  async function runAutosave(
    serverDraft = draftWithoutPendingImages(draft, pendingImagesRef.current),
    signature = articleDraftSignature(serverDraft),
    storageKey = localDraftKey,
  ): Promise<void> {
    if (autosaveRequestRef.current || signature === lastSavedSignatureRef.current) return;
    const token = readAccessToken();
    if (!token) return;
    const previousArticle = articleRef.current;
    setAutosaveState("saving");
    const request = (async () => {
      try {
        const saved = await autosaveArticle(token, previousArticle?.id ?? null, serverDraft);
        articleRef.current = saved;
        setArticle(saved);
        lastSavedSignatureRef.current = signature;
        setLastAutosavedAt(new Date(saved.updatedAt));
        setAutosaveState("saved");
        if (!previousArticle && !articleId) {
          window.history.replaceState(window.history.state, "", `/articles/edit/${saved.id}`);
          removeLocalArticleDraft(`${ARTICLE_LOCAL_DRAFT_PREFIX}:${user?.id ?? saved.author.id}:new`);
        }
        if (!pendingImagesRef.current.length) removeLocalArticleDraft(storageKey);
        if (isVersionsOpen) void loadVersions(saved.id);
      } catch (saveError) {
        if (isAuthExpiredError(saveError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        setAutosaveState("offline");
      }
    })();
    autosaveRequestRef.current = request;
    await request.finally(() => {
      autosaveRequestRef.current = null;
    });
  }

  function prepareImages(files: File[]): PendingArticleImage[] {
    const availableSlots = Math.max(
      0,
      MAX_ARTICLE_IMAGES - (article?.images.length ?? 0) - pendingImages.length,
    );
    if (!availableSlots) {
      setError(phrase(`单篇文章最多包含 ${MAX_ARTICLE_IMAGES} 张图片。`, `An article can contain at most ${MAX_ARTICLE_IMAGES} images.`));
      return [];
    }

    const accepted: PendingArticleImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(phrase(`${file.name} 不是支持的图片格式。`, `${file.name} is not a supported image format.`));
        continue;
      }
      if (file.size > imageMaxSizeMb * 1024 * 1024) {
        setError(phrase(`${file.name} 超过单张 ${imageMaxSizeMb}MB 限制。`, `${file.name} exceeds the ${imageMaxSizeMb} MB per-image limit.`));
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
      setError(phrase(`本次最多还能添加 ${availableSlots} 张图片。`, `You can add at most ${availableSlots} more image(s) this time.`));
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
      .map((image) => `![${sanitizeImageAlt(image.file.name, locale)}](${image.marker})`)
      .join("\n\n");
    const trailingBreaks = before.match(/\n*$/)?.[0].length ?? 0;
    const leadingBreaks = after.match(/^\n*/)?.[0].length ?? 0;
    const prefix = before ? "\n".repeat(Math.max(0, 2 - trailingBreaks)) : "";
    const suffix = after ? "\n".repeat(Math.max(0, 2 - leadingBreaks)) : "";
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
    const current = articleRef.current;
    if (!current) return "draft";
    if (current.status === "published" || current.status === "unpublished" || current.status === "blocked") return current.status;
    return "draft";
  }

  function toggleTag(tag: string) {
    const nextTags = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
    if (nextTags.length > MAX_SELECTED_TAGS) {
      setError(phrase(`最多选择 ${MAX_SELECTED_TAGS} 个标签。`, `Choose at most ${MAX_SELECTED_TAGS} tags.`));
      return;
    }
    setDraft((current) => ({ ...current, tags: nextTags.join(",") }));
  }

  async function saveArticle(shouldPublish: boolean) {
    const token = readAccessToken();
    if (!token) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      setError(phrase("标题和正文不能为空。", "Title and content are required."));
      return;
    }
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (autosaveRequestRef.current) await autosaveRequestRef.current;
    setIsSaving(true);
    try {
      const currentArticle = articleRef.current;
      const wasNewArticle = !currentArticle;
      const usedPendingImages = pendingImages.filter((image) => draft.content.includes(image.marker));
      let saved = currentArticle;
      let finalContent = draft.content;

      if (!saved) {
        saved = await createArticle(token, {
          ...draft,
          summary: "",
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
          throw new Error(phrase("部分图片上传失败，请重新保存。", "Some image uploads failed. Save again."));
        }
        finalContent = replacePendingImageMarkers(draft.content, usedPendingImages, imagePaths);
      }

      if (!wasNewArticle || usedPendingImages.length) {
        saved = await updateArticle(token, saved.id, {
          ...draft,
          summary: "",
          content: finalContent,
          status: wasNewArticle ? saved.status : currentEditableStatus(),
        });
      }

      if (shouldPublish) {
        await publishArticle(token, saved.id);
        releasePendingImages();
        removeLocalArticleDraft(localDraftKey);
        router.replace(localizedPath("/articles/mine?status=published", locale));
        return;
      }

      releasePendingImages();
      applyArticle(saved);
      removeLocalArticleDraft(localDraftKey);
      if (wasNewArticle && !articleId) {
        window.history.replaceState(window.history.state, "", `/articles/edit/${saved.id}`);
      }
      setNotice(saved.status === "blocked" ? phrase("修改已保存，文章仍处于受限状态。", "Changes saved. The article remains restricted.") : wasNewArticle ? phrase("草稿已保存。", "Draft saved.") : phrase("文章修改已保存。", "Article changes saved."));
      if (isVersionsOpen) void loadVersions(saved.id);
    } catch (saveError) {
      if (isAuthExpiredError(saveError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(saveError instanceof Error ? saveError.message : phrase("文章保存失败。", "Could not save the article."));
    } finally {
      setIsSaving(false);
    }
  }

  function recoverLocalDraft() {
    if (!recoveryDraft) return;
    setDraft(recoveryDraft.draft);
    setRecoveryDraft(null);
    setAutosaveState("waiting");
    if (recoveryDraft.pendingImageNames.length) {
      setNotice(phrase(`已恢复文字内容；${recoveryDraft.pendingImageNames.length} 张未上传图片需要重新选择。`, `Text restored. ${recoveryDraft.pendingImageNames.length} unsaved image(s) must be selected again.`));
    } else {
      setNotice(phrase("已恢复本地草稿，将自动重新保存。", "Local draft restored and will save automatically."));
    }
  }

  function discardRecoveryDraft() {
    if (localDraftKey) removeLocalArticleDraft(localDraftKey);
    setRecoveryDraft(null);
  }

  async function loadVersions(targetArticleId = articleRef.current?.id) {
    const token = readAccessToken();
    if (!token || !targetArticleId) return;
    setIsLoadingVersions(true);
    try {
      const result = await listArticleVersions(token, targetArticleId);
      setVersions(result.items);
      if (selectedVersion && !result.items.some((version) => version.id === selectedVersion.id)) {
        setSelectedVersion(null);
      }
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : phrase("无法读取历史版本。", "Could not load version history."));
    } finally {
      setIsLoadingVersions(false);
    }
  }

  async function openVersions() {
    if (!articleRef.current) {
      setNotice(phrase("首次自动保存后即可查看历史版本。", "Version history is available after the first autosave."));
      return;
    }
    setIsVersionsOpen(true);
    setSelectedVersion(null);
    await loadVersions(articleRef.current.id);
  }

  async function selectVersion(versionId: number) {
    const token = readAccessToken();
    const current = articleRef.current;
    if (!token || !current) return;
    setIsLoadingVersions(true);
    try {
      setSelectedVersion(await getArticleVersion(token, current.id, versionId));
    } catch (versionError) {
      setError(versionError instanceof Error ? versionError.message : phrase("无法读取版本内容。", "Could not load version content."));
    } finally {
      setIsLoadingVersions(false);
    }
  }

  async function restoreSelectedVersion() {
    const token = readAccessToken();
    const current = articleRef.current;
    if (!token || !current || !selectedVersion) return;
    if (!window.confirm(phrase(`恢复到版本 ${selectedVersion.versionNumber}？当前内容会先保留在版本历史中。`, `Restore version ${selectedVersion.versionNumber}? Current content will remain in version history.`))) return;
    setIsSaving(true);
    try {
      const restored = await restoreArticleVersion(token, current.id, selectedVersion.id);
      releasePendingImages();
      applyArticle(restored);
      removeLocalArticleDraft(localDraftKey);
      setSelectedVersion(null);
      await loadVersions(restored.id);
      setNotice(phrase("历史版本已恢复为新草稿。", "Version restored as a new draft."));
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : phrase("恢复历史版本失败。", "Could not restore the historical version."));
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
      setNotice(phrase("文章已下架。", "Article unpublished."));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : phrase("文章下架失败。", "Could not unpublish the article."));
    }
  }

  async function moveToTrash() {
    if (!article || !window.confirm(phrase(`将《${article.title}》移入回收站吗？`, `Move “${article.title}” to the recycle bin?`))) return;
    const token = readAccessToken();
    if (!token) return;
    try {
      await deleteArticle(token, article.id);
      router.replace(localizedPath("/articles/mine?status=deleted", locale));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : phrase("文章删除失败。", "Could not delete the article."));
    }
  }

  return (
    <section className="page-shell articles-page article-editor-page">
      <ArticleCenterNav active="mine" isLoggedIn user={user} showWrite={false} />
      <div className="article-editor-context">
        <span className={`article-status-dot ${article?.status ?? "draft"}`}>
          {article ? articleStatusLabel(article.status) : phrase("新文章", "New article")}
        </span>
        <div className="article-editor-context-actions">
          <span className={`article-autosave-state ${autosaveState}`}>
            {autosaveState === "offline" ? <CloudOff aria-hidden="true" size={15} /> : <Cloud aria-hidden="true" size={15} />}
            {autosaveState === "waiting" ? phrase("等待自动保存", "Waiting to autosave") : autosaveState === "saving" ? phrase("自动保存中", "Autosaving") : autosaveState === "offline" ? phrase("已保存在本机", "Saved locally") : lastAutosavedAt ? phrase(`${formatShortTime(lastAutosavedAt, locale)} 已保存`, `Saved at ${formatShortTime(lastAutosavedAt, locale)}`) : phrase("自动保存已开启", "Autosave is on")}
            {autosaveState === "offline" ? <button aria-label={phrase("重试自动保存", "Retry autosave")} onClick={() => void runAutosave()} title={phrase("重试", "Retry")} type="button"><RefreshCw aria-hidden="true" size={14} /></button> : null}
          </span>
          <button className="text-action" onClick={() => void openVersions()} type="button"><History aria-hidden="true" size={15} />{phrase("历史版本", "Version history")}</button>
          <button className="text-action" onClick={() => setIsPreviewOpen(true)} type="button"><Eye aria-hidden="true" size={15} />{phrase("发布预览", "Publish preview")}</button>
        </div>
      </div>

      {recoveryDraft ? <div className="article-draft-recovery"><span><strong>{phrase("发现未提交的本地草稿", "An unsaved local draft was found")}</strong><small>{formatRecoveryTime(recoveryDraft.savedAt, locale)}{recoveryDraft.pendingImageNames.length ? phrase(` · ${recoveryDraft.pendingImageNames.length} 张图片需要重新选择`, ` · ${recoveryDraft.pendingImageNames.length} images must be selected again`) : ""}</small></span><div><button className="text-action" onClick={recoverLocalDraft} type="button"><RotateCcw aria-hidden="true" size={14} />{phrase("恢复", "Restore")}</button><button className="text-danger-action" onClick={discardRecoveryDraft} type="button">{phrase("丢弃", "Discard")}</button></div></div> : null}

      {isLoading ? <div className="article-empty-state">{phrase("正在读取文章。", "Loading article.")}</div> : (
        <div className="article-editor-workspace">
          <section className="article-editor-panel">
            {article?.status === "blocked" ? <div className="article-blocked-reason">{phrase("这篇文章当前受限。", "This article is currently restricted.")}{article.blockedReason ? `${phrase("原因：", "Reason: ")}${article.blockedReason}` : phrase("修改可以保存，但需要管理员解除限制后才能重新发布。", "Edits can be saved, but an administrator must remove the restriction before it can be published again.")}</div> : null}
            <div className="article-editor-fields">
              <input className="article-title-input" maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={phrase("文章标题", "Article title")} value={draft.title} />
              <div className="article-editor-taxonomy-grid">
                <div className="article-category-picker" ref={categoryPickerRef}>
                  <span>{phrase("分类", "Category")}</span>
                  <button
                    aria-expanded={isCategoryPickerOpen}
                    className="article-category-picker-trigger"
                    onClick={() => {
                      setIsCategoryPickerOpen((current) => !current);
                      setIsTagPickerOpen(false);
                    }}
                    type="button"
                  >
                    <span>{draft.category ? displayArticleTaxonomy(draft.category, locale) : phrase("随笔", "Essay")}</span>
                    <ChevronDown aria-hidden="true" size={15} />
                  </button>
                  {isCategoryPickerOpen ? (
                    <div className="article-category-picker-menu">
                      {categoryOptions.map((category) => {
                        const selected = draft.category === category;
                        return (
                          <button
                            aria-pressed={selected}
                            className={selected ? "selected" : undefined}
                            key={category}
                            onClick={() => {
                              setDraft((current) => ({ ...current, category }));
                              setIsCategoryPickerOpen(false);
                            }}
                            type="button"
                          >
                            <span>{displayArticleTaxonomy(category, locale)}</span>{selected ? <Check aria-hidden="true" size={14} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="article-tag-picker" ref={tagPickerRef}>
                  <span>{phrase("标签", "Tags")}</span>
                  <button
                    aria-expanded={isTagPickerOpen}
                    className="article-tag-picker-trigger"
                    onClick={() => {
                      setIsTagPickerOpen((current) => !current);
                      setIsCategoryPickerOpen(false);
                    }}
                    type="button"
                  >
                    <Tags aria-hidden="true" size={16} />
                    <span className={`article-tag-picker-values${selectedTags.length ? " selected" : ""}`}>
                      {selectedTags.length
                        ? selectedTags.map((tag) => <span key={tag}>#{displayArticleTaxonomy(tag, locale)}</span>)
                        : phrase("选择标签", "Choose tags")}
                    </span>
                    <ChevronDown aria-hidden="true" size={15} />
                  </button>
                  {isTagPickerOpen ? (
                    <div className="article-tag-picker-menu">
                      {tagOptions.map((tag) => {
                        const selected = selectedTags.includes(tag);
                        return (
                          <button aria-pressed={selected} className={selected ? "selected" : undefined} key={tag} onClick={() => toggleTag(tag)} type="button">
                            <span>{displayArticleTaxonomy(tag, locale)}</span>{selected ? <Check aria-hidden="true" size={14} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="article-editor-grid"><label>{phrase("阅读权限", "Visibility")}<GlassSelect ariaLabel={phrase("阅读权限", "Visibility")} onChange={(visibility) => setDraft({ ...draft, visibility })} options={visibilityOptions} value={draft.visibility} /></label><label>{phrase("标题颜色", "Title color")}<input aria-label={phrase("标题颜色", "Title color")} onChange={(event) => setDraft({ ...draft, titleColor: event.target.value })} type="color" value={draft.titleColor || "#2b2530"} /></label></div>
              <div className="article-resource-settings">
                <strong>{phrase("局部积分资源", "Partial point resource")}</strong>
                <span>{phrase("在正文中使用 ", "Use ")}<code>:::resource&#123;points=10&#125;</code>{phrase(" 和 ", " and ")}<code>:::</code>{phrase(" 包住需要兑换的内容；普通正文仍可直接阅读。", " around content that requires redemption; the rest stays readable.")}</span>
              </div>
              {draft.visibility === "role_restricted" ? <input onChange={(event) => setDraft({ ...draft, roleCodes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder={phrase("角色代码，用逗号分隔", "Role codes, separated by commas")} value={draft.roleCodes.join(", ")} /> : null}
            </div>
             <textarea className="article-editor-textarea" onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder={phrase("支持 Markdown：标题、列表、表格、引用、链接、图片、代码块和局部积分资源块", "Markdown is supported: headings, lists, tables, quotes, links, images, code blocks, and partial point-resource blocks")} ref={textareaRef} value={draft.content} />
            <div className="article-editor-upload"><label className="text-action"><ImagePlus aria-hidden="true" size={16} />{phrase("添加图片", "Add images")}<input accept="image/jpeg,image/png,image/webp,image/avif" hidden multiple onChange={(event) => { insertImagesAtCursor(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" /></label><span>{pendingImages.length ? phrase(`待上传 ${pendingImages.length} 张，保存时才会上传`, `${pendingImages.length} image(s) pending upload and will upload when saved`) : phrase(`支持 JPG、PNG、WebP、AVIF，单张不超过 ${imageMaxSizeMb}MB`, `JPG, PNG, WebP, and AVIF are supported, up to ${imageMaxSizeMb}MB each`)}</span></div>
            {pendingImages.length ? <div className="article-pending-images">{pendingImages.map((image) => <span key={image.id}>{image.file.name}<button aria-label={phrase(`移除 ${image.file.name}`, `Remove ${image.file.name}`)} onClick={() => removePendingImage(image)} title={phrase("移除图片", "Remove image")} type="button"><X aria-hidden="true" size={14} /></button></span>)}</div> : null}
            <div className="article-editor-actions"><button className="button secondary" disabled={isSaving || autosaveState === "saving"} onClick={() => void saveArticle(false)} type="button"><Save aria-hidden="true" size={16} />{isSaving ? phrase("保存中", "Saving") : article ? phrase("保存修改", "Save changes") : phrase("保存草稿", "Save draft")}</button><button className="button" disabled={isSaving || autosaveState === "saving" || article?.status === "blocked"} onClick={() => void saveArticle(true)} type="button"><Send aria-hidden="true" size={16} />{phrase("发布文章", "Publish article")}</button>{article?.status === "published" ? <button className="text-action" disabled={isSaving} onClick={() => void takeOffline()} type="button">{phrase("下架", "Unpublish")}</button> : null}{article ? <button className="text-danger-action" disabled={isSaving} onClick={() => void moveToTrash()} type="button"><Trash2 aria-hidden="true" size={16} />{phrase("删除", "Delete")}</button> : null}</div>
          </section>
          <aside className="article-editor-preview"><div className="article-editor-preview-heading"><span className="section-label">{phrase("预览", "Preview")}</span><span>{phrase("正文预览", "Content preview")}</span></div><ArticleBody content={draft.content || phrase("开始输入后，这里会显示文章预览。", "Start writing to see an article preview here.")} pendingImageUrls={pendingImageUrls} /></aside>
        </div>
      )}
      {isPreviewOpen && typeof document !== "undefined" ? createPortal(<div className="article-preview-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsPreviewOpen(false); }}><section aria-label={phrase("文章发布预览", "Article publish preview")} aria-modal="true" className="article-publish-preview" role="dialog"><header className="article-preview-toolbar"><span><Eye aria-hidden="true" size={17} /><strong>{phrase("发布预览", "Publish preview")}</strong></span><button aria-label={phrase("关闭预览", "Close preview")} onClick={() => setIsPreviewOpen(false)} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={18} /></button></header><article className="article-reading-layout"><header className="article-reading-header"><h1 style={draft.titleColor ? { color: draft.titleColor } : undefined}>{draft.title || phrase("未命名文章", "Untitled article")}</h1><div className="article-reading-author"><span>{user?.nickname || user?.username || phrase("当前用户", "Current user")}</span><span className="article-reading-divider" /><span>{phrase(`预览于 ${formatArticleDate(new Date().toISOString(), locale)}`, `Previewed ${formatArticleDate(new Date().toISOString(), locale)}`)}</span></div></header><div className="article-reading-grid preview"><aside className="article-reading-aside"><dl className="article-aside-meta"><div><dt>{phrase("分类", "Category")}</dt><dd>{draft.category ? displayArticleTaxonomy(draft.category, locale) : phrase("随笔", "Essay")}</dd></div><div><dt>{phrase("阅读权限", "Visibility")}</dt><dd>{visibilityLabel(draft.visibility)}</dd></div></dl>{selectedTags.length ? <div className="article-tag-list">{selectedTags.map((tag) => <span key={tag}>#{displayArticleTaxonomy(tag, locale)}</span>)}</div> : null}</aside><main className="article-reading-main"><ArticleBody content={draft.content || phrase("开始输入后，这里会显示文章预览。", "Start writing to see the article preview here.")} pendingImageUrls={pendingImageUrls} /></main></div></article></section></div>, document.body) : null}
      {isVersionsOpen && typeof document !== "undefined" ? createPortal(<div className="article-versions-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setIsVersionsOpen(false); }}><section aria-label={phrase("文章历史版本", "Article version history")} aria-modal="true" className="article-versions-dialog" role="dialog"><header><span><History aria-hidden="true" size={17} /><strong>{phrase("历史版本", "Version history")}</strong></span><button aria-label={phrase("关闭历史版本", "Close version history")} onClick={() => setIsVersionsOpen(false)} title={phrase("关闭", "Close")} type="button"><X aria-hidden="true" size={18} /></button></header><div className="article-versions-layout"><nav>{isLoadingVersions && !versions.length ? <span className="article-version-empty">{phrase("正在读取版本。", "Loading versions.")}</span> : versions.map((version) => <button className={selectedVersion?.id === version.id ? "active" : undefined} key={version.id} onClick={() => void selectVersion(version.id)} type="button"><span><strong>{phrase(`版本 ${version.versionNumber}`, `Version ${version.versionNumber}`)}</strong><em>{versionSourceLabel(version.source)}</em></span><small>{formatVersionTime(version.createdAt, locale)}</small><small>{version.changedFields.map((field) => versionFieldLabel(field)).join(locale === "en-US" ? ", " : "、") || phrase("内容未变化", "No content changes")}</small></button>)}</nav><div className="article-version-detail">{selectedVersion ? <><div><span><strong>{phrase(`版本 ${selectedVersion.versionNumber}`, `Version ${selectedVersion.versionNumber}`)}</strong><small>{versionSourceLabel(selectedVersion.source)} · {formatVersionTime(selectedVersion.createdAt, locale)}</small></span><button className="button secondary" disabled={isSaving} onClick={() => void restoreSelectedVersion()} type="button"><RotateCcw aria-hidden="true" size={15} />{phrase("恢复此版本", "Restore this version")}</button></div><h2>{selectedVersion.title || phrase("未命名文章", "Untitled article")}</h2><div className="article-version-taxonomy"><span>{selectedVersion.category ? displayArticleTaxonomy(selectedVersion.category, locale) : phrase("随笔", "Essay")}</span>{selectedVersion.tags.map((tag) => <span key={tag}>#{displayArticleTaxonomy(tag, locale)}</span>)}</div><ArticleBody content={selectedVersion.content || phrase("此版本没有正文内容。", "This version has no article content.")} /></> : <span className="article-version-empty">{phrase("选择左侧版本查看完整内容。", "Choose a version on the left to view its full content.")}</span>}</div></div></section></div>, document.body) : null}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function sanitizeImageAlt(value: string, locale: "zh-CN" | "en-US"): string {
  return value.replace(/[\[\]\r\n]/g, " ").trim() || (locale === "en-US" ? "Image" : "图片");
}

function parseArticleTags(value: string): string[] {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
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

function draftWithoutPendingImages(draft: ArticleInput, pendingImages: PendingArticleImage[]): ArticleInput {
  return {
    ...draft,
    content: stripPendingImageMarkdown(draft.content, pendingImages),
  };
}

function articleDraftSignature(draft: ArticleInput): string {
  return JSON.stringify({
    ...draft,
    roleCodes: [...draft.roleCodes].sort(),
    tags: parseArticleTags(draft.tags).sort().join(","),
  });
}

function readLocalArticleDraft(key: string): LocalArticleDraft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<LocalArticleDraft> | null;
    if (!parsed?.draft || typeof parsed.savedAt !== "string") return null;
    return {
      draft: { ...emptyDraft, ...parsed.draft, roleCodes: parsed.draft.roleCodes ?? [] },
      savedAt: parsed.savedAt,
      pendingImageNames: Array.isArray(parsed.pendingImageNames)
        ? parsed.pendingImageNames.filter((name): name is string => typeof name === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function writeLocalArticleDraft(key: string, value: LocalArticleDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled localStorage must not interrupt editing.
  }
}

function removeLocalArticleDraft(key: string): void {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore browser storage restrictions.
  }
}

function formatShortTime(value: Date, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function formatRecoveryTime(value: string, locale: "zh-CN" | "en-US"): string {
  const time = formatVersionTime(value, locale);
  return locale === "en-US" ? `Saved at ${time}` : `保存于 ${time}`;
}

function formatVersionTime(value: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
