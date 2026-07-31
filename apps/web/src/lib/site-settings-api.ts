import { requestJson, resolveApiUrl } from "./auth-api";
import type { ThemeId } from "./theme-preferences";

export type ArticleVisibility = "public" | "authenticated" | "role_restricted" | "private";
export type ArticleTaxonomyKind = "category" | "tag";
export type SiteAssetKind = "logo" | "pwa_icon";

export interface SiteThemeDefaults {
  themeId: ThemeId;
  customAccent: string;
  customSurface: string;
  customForeground: string;
  customMuted: string;
  cardAlpha: number;
  glassBlur: number;
  glassTint: string;
  glassTintAlpha: number;
}

export interface ArticleTaxonomy {
  id: number;
  kind: ArticleTaxonomyKind;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteAsset {
  id: number;
  kind: SiteAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedBy: {
    id: number;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  notifyArticleLiked: boolean;
  notifyArticleFavorited: boolean;
  notifyArticleCommented: boolean;
  notifyCommentReplied: boolean;
  notifyAuthorSubscribed: boolean;
  notifySubscriptionPublished: boolean;
  notifyFriendRequest: boolean;
  notifyCommentReport: boolean;
  notifySystem: boolean;
  templates: {
    articleLiked: string;
    articleFavorited: string;
    articleCommented: string;
    commentReplied: string;
    authorSubscribed: string;
    subscriptionPublished: string;
    friendRequest: string;
    commentReportHandled: string;
    commentAuthorModerated: string;
  };
}

export interface SiteSettings {
  siteName: string;
  browserTitle: string;
  logoPath: string;
  pwaIconPath: string;
  defaultBackgroundUrl: string;
  defaultTheme: SiteThemeDefaults;
  registrationOpen: boolean;
  defaultRoleCode: string;
  installPageEnabled: boolean;
  apkHistoryEnabled: boolean;
  apkAutoCleanupEnabled: boolean;
  apkRetentionCount: number;
  defaultArticleVisibility: ArticleVisibility;
  articleImageMaxSizeMb: number;
  commentsEnabled: boolean;
  reportsEnabled: boolean;
  notifications: NotificationSettings;
  taxonomies: {
    categories: ArticleTaxonomy[];
    tags: ArticleTaxonomy[];
  };
  updatedAt: string;
}

export interface SiteSettingsInput {
  siteName: string;
  browserTitle: string;
  logoPath: string;
  pwaIconPath: string;
  defaultBackgroundUrl: string;
  defaultThemeId: ThemeId;
  defaultAccent: string;
  defaultSurface: string;
  defaultForeground: string;
  defaultMuted: string;
  defaultCardAlpha: number;
  defaultGlassBlur: number;
  defaultGlassTint: string;
  defaultGlassTintAlpha: number;
  registrationOpen: boolean;
  defaultRoleCode: string;
  installPageEnabled: boolean;
  apkHistoryEnabled: boolean;
  apkAutoCleanupEnabled: boolean;
  apkRetentionCount: number;
  defaultArticleVisibility: ArticleVisibility;
  articleImageMaxSizeMb: number;
  commentsEnabled: boolean;
  reportsEnabled: boolean;
  notifyArticleLiked: boolean;
  notifyArticleFavorited: boolean;
  notifyArticleCommented: boolean;
  notifyCommentReplied: boolean;
  notifyAuthorSubscribed: boolean;
  notifySubscriptionPublished: boolean;
  notifyFriendRequest: boolean;
  notifyCommentReport: boolean;
  notifySystem: boolean;
  templateArticleLiked: string;
  templateArticleFavorited: string;
  templateArticleCommented: string;
  templateCommentReplied: string;
  templateAuthorSubscribed: string;
  templateSubscriptionPublished: string;
  templateFriendRequest: string;
  templateCommentReportHandled: string;
  templateCommentAuthorModerated: string;
}

export interface ArticleTaxonomyInput {
  kind: ArticleTaxonomyKind;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
}

export function getPublicSiteSettings(): Promise<SiteSettings> {
  return requestJson<SiteSettings>("/site-settings/public", { cache: "no-store" });
}

export function getAdminSiteSettings(accessToken: string): Promise<SiteSettings> {
  return requestJson<SiteSettings>("/site-settings", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function updateSiteSettings(accessToken: string, input: SiteSettingsInput): Promise<SiteSettings> {
  return requestJson<SiteSettings>("/site-settings", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
}

export function listSiteAssets(accessToken: string, kind?: SiteAssetKind): Promise<SiteAsset[]> {
  const query = kind ? `?kind=${kind}` : "";
  return requestJson<SiteAsset[]>(`/site-settings/assets${query}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function uploadSiteAsset(
  accessToken: string,
  kind: SiteAssetKind,
  file: File,
): Promise<SiteAsset> {
  const body = new FormData();
  body.append("kind", kind);
  body.append("file", file);
  return requestJson<SiteAsset>("/site-settings/assets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
}

export function deleteSiteAsset(accessToken: string, id: number): Promise<void> {
  return requestJson<void>(`/site-settings/assets/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function resolveSiteAssetUrl(asset: Pick<SiteAsset, "url">): string {
  return resolveApiUrl(asset.url);
}

export function toConfiguredApiAssetPath(path: string): string {
  return path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
}

export function createArticleTaxonomy(accessToken: string, input: ArticleTaxonomyInput): Promise<ArticleTaxonomy> {
  return requestJson<ArticleTaxonomy>("/site-settings/taxonomies", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
}

export function updateArticleTaxonomy(
  accessToken: string,
  id: number,
  input: ArticleTaxonomyInput,
): Promise<ArticleTaxonomy> {
  return requestJson<ArticleTaxonomy>(`/site-settings/taxonomies/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
}

export function deleteArticleTaxonomy(accessToken: string, id: number): Promise<void> {
  return requestJson<void>(`/site-settings/taxonomies/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function siteSettingsToInput(settings: SiteSettings): SiteSettingsInput {
  return {
    siteName: settings.siteName,
    browserTitle: settings.browserTitle,
    logoPath: settings.logoPath,
    pwaIconPath: settings.pwaIconPath,
    defaultBackgroundUrl: settings.defaultBackgroundUrl,
    defaultThemeId: settings.defaultTheme.themeId,
    defaultAccent: settings.defaultTheme.customAccent,
    defaultSurface: settings.defaultTheme.customSurface,
    defaultForeground: settings.defaultTheme.customForeground,
    defaultMuted: settings.defaultTheme.customMuted,
    defaultCardAlpha: settings.defaultTheme.cardAlpha,
    defaultGlassBlur: settings.defaultTheme.glassBlur,
    defaultGlassTint: settings.defaultTheme.glassTint,
    defaultGlassTintAlpha: settings.defaultTheme.glassTintAlpha,
    registrationOpen: settings.registrationOpen,
    defaultRoleCode: settings.defaultRoleCode,
    installPageEnabled: settings.installPageEnabled,
    apkHistoryEnabled: settings.apkHistoryEnabled,
    apkAutoCleanupEnabled: settings.apkAutoCleanupEnabled,
    apkRetentionCount: settings.apkRetentionCount,
    defaultArticleVisibility: settings.defaultArticleVisibility,
    articleImageMaxSizeMb: settings.articleImageMaxSizeMb,
    commentsEnabled: settings.commentsEnabled,
    reportsEnabled: settings.reportsEnabled,
    notifyArticleLiked: settings.notifications.notifyArticleLiked,
    notifyArticleFavorited: settings.notifications.notifyArticleFavorited,
    notifyArticleCommented: settings.notifications.notifyArticleCommented,
    notifyCommentReplied: settings.notifications.notifyCommentReplied,
    notifyAuthorSubscribed: settings.notifications.notifyAuthorSubscribed,
    notifySubscriptionPublished: settings.notifications.notifySubscriptionPublished,
    notifyFriendRequest: settings.notifications.notifyFriendRequest,
    notifyCommentReport: settings.notifications.notifyCommentReport,
    notifySystem: settings.notifications.notifySystem,
    templateArticleLiked: settings.notifications.templates.articleLiked,
    templateArticleFavorited: settings.notifications.templates.articleFavorited,
    templateArticleCommented: settings.notifications.templates.articleCommented,
    templateCommentReplied: settings.notifications.templates.commentReplied,
    templateAuthorSubscribed: settings.notifications.templates.authorSubscribed,
    templateSubscriptionPublished: settings.notifications.templates.subscriptionPublished,
    templateFriendRequest: settings.notifications.templates.friendRequest,
    templateCommentReportHandled: settings.notifications.templates.commentReportHandled,
    templateCommentAuthorModerated: settings.notifications.templates.commentAuthorModerated,
  };
}
