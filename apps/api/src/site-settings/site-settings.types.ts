import { ArticleTaxonomyKind, ArticleVisibility, SiteAssetKind } from "../generated/prisma/client";

export interface ThemeDefaultsResponse {
  themeId: string;
  customAccent: string;
  customSurface: string;
  customForeground: string;
  customMuted: string;
  cardAlpha: number;
  glassBlur: number;
  glassTint: string;
  glassTintAlpha: number;
}

export interface ArticleTaxonomyResponse {
  id: number;
  kind: ArticleTaxonomyKind;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteAssetResponse {
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

export interface SiteSettingsResponse {
  siteName: string;
  browserTitle: string;
  logoPath: string;
  pwaIconPath: string;
  defaultBackgroundUrl: string;
  defaultTheme: ThemeDefaultsResponse;
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
  notifications: NotificationSettingsResponse;
  taxonomies: {
    categories: ArticleTaxonomyResponse[];
    tags: ArticleTaxonomyResponse[];
  };
  updatedAt: string;
}

export interface NotificationSettingsResponse {
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

export interface RegistrationPolicy {
  registrationOpen: boolean;
  defaultRoleCode: string;
}

export interface AndroidReleasePolicy {
  installPageEnabled: boolean;
  apkHistoryEnabled: boolean;
  apkAutoCleanupEnabled: boolean;
  apkRetentionCount: number;
}

export interface ArticlePublishPolicy {
  defaultArticleVisibility: ArticleVisibility;
  articleImageMaxSizeMb: number;
  commentsEnabled: boolean;
  reportsEnabled: boolean;
}

export type NotificationTemplateName =
  | "articleLiked"
  | "articleFavorited"
  | "articleCommented"
  | "commentReplied"
  | "authorSubscribed"
  | "subscriptionPublished"
  | "friendRequest"
  | "commentReportHandled"
  | "commentAuthorModerated";
